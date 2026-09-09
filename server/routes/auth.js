import express from 'express';
import { config, devCodesEnabled } from '../config.js';
import { get, run, transaction } from '../db.js';
import { sendOtpEmail } from '../mailer.js';
import {
  clearSessionCookie,
  createSession,
  destroySession,
  requireSession,
  setSessionCookie,
} from '../auth.js';
import { findOrCreateUserByEmail, privateUser, userByEmail, userByUsername, notify } from '../store.js';
import { LIMITS } from '../constants.js';
import {
  badRequest,
  createRateLimiter,
  forbidden,
  generateOtp,
  isoPlus,
  normalizeEmail,
  normalizeUsername,
  nowIso,
  safeEqual,
  sha256,
  text,
  verifyPassword,
  wrap,
} from '../util.js';

export const router = express.Router();

const requestLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 10 });
const verifyLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 30 });
const passwordLoginLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20 });

const RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'root', 'support', 'api', 'settings', 'login',
  'search', 'explore', 'notifications', 'compose', 'about', 'help', 'promptshare',
]);

/** POST /api/auth/request-code — отправляет одноразовый код на почту. */
router.post(
  '/request-code',
  wrap(async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const ip = req.ip || 'unknown';

    for (const key of [`ip:${ip}`, `email:${email}`]) {
      const check = requestLimiter(key);
      if (!check.ok) {
        res.set('Retry-After', String(check.retryAfter));
        throw badRequest(
          `Слишком много запросов. Попробуйте через ${check.retryAfter} сек.`,
          'rate_limited',
        );
      }
    }

    const existing = userByEmail(email);
    if (existing?.status === 'banned') {
      throw forbidden(`Аккаунт заблокирован: ${existing.status_reason || 'нарушение правил'}`);
    }

    // Не даём спамить кодами чаще, чем раз в cooldown.
    const last = get(
      `SELECT created_at FROM otp_codes WHERE email = $email
       ORDER BY id DESC LIMIT 1`,
      { email },
    );
    if (last) {
      const ageSec = (Date.now() - new Date(`${last.created_at}Z`).getTime()) / 1000;
      if (ageSec < config.otp.resendCooldownSeconds) {
        const wait = Math.ceil(config.otp.resendCooldownSeconds - ageSec);
        throw badRequest(`Новый код можно запросить через ${wait} сек.`, 'cooldown');
      }
    }

    const code = generateOtp(config.otp.length);
    run(
      `INSERT INTO otp_codes (email, code_hash, expires_at)
       VALUES ($email, $hash, $expiresAt)`,
      {
        email,
        hash: sha256(`${email}:${code}`),
        expiresAt: isoPlus(config.otp.ttlMinutes * 60 * 1000),
      },
    );

    try {
      await sendOtpEmail({ to: email, code, ttlMinutes: config.otp.ttlMinutes });
    } catch {
      throw new Error('Не удалось отправить письмо с кодом. Попробуйте позже.');
    }

    res.json({
      ok: true,
      email,
      isNewUser: !existing,
      ttlMinutes: config.otp.ttlMinutes,
      // Только в dev-режиме без SMTP — чтобы можно было войти без почтового сервера.
      devCode: devCodesEnabled ? code : undefined,
    });
  }),
);

/** POST /api/auth/verify — проверяет код и открывает сессию. */
router.post(
  '/verify',
  wrap(async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const code = String(req.body?.code ?? '').trim();
    if (!/^\d{4,8}$/.test(code)) throw badRequest('Введите код из письма');

    const check = verifyLimiter(`${req.ip}:${email}`);
    if (!check.ok) throw badRequest('Слишком много попыток. Попробуйте позже.', 'rate_limited');

    const record = get(
      `SELECT * FROM otp_codes
       WHERE email = $email AND consumed_at IS NULL AND expires_at > $now
       ORDER BY id DESC LIMIT 1`,
      { email, now: nowIso() },
    );
    if (!record) throw badRequest('Код истёк или не найден. Запросите новый.', 'code_expired');
    if (record.attempts >= config.otp.maxAttempts) {
      throw badRequest('Превышено число попыток. Запросите новый код.', 'too_many_attempts');
    }

    if (!safeEqual(record.code_hash, sha256(`${email}:${code}`))) {
      run('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $id', { id: record.id });
      const left = config.otp.maxAttempts - record.attempts - 1;
      throw badRequest(
        left > 0 ? `Неверный код. Осталось попыток: ${left}` : 'Неверный код. Запросите новый.',
        'invalid_code',
      );
    }

    const user = transaction(() => {
      run('UPDATE otp_codes SET consumed_at = $now WHERE id = $id', { id: record.id, now: nowIso() });
      run('DELETE FROM otp_codes WHERE email = $email AND consumed_at IS NULL', { email });
      return findOrCreateUserByEmail(email, { adminEmails: config.adminEmails });
    });

    if (user.status === 'banned') {
      throw forbidden(`Аккаунт заблокирован: ${user.status_reason || 'нарушение правил'}`);
    }

    const token = createSession(user.id, req.get('user-agent') || '');
    setSessionCookie(res, token);
    res.json({ ok: true, user: privateUser(user), needsProfile: !user.username });
  }),
);

/** POST /api/auth/login-password — вход по email+паролю (альтернатива коду). */
router.post(
  '/login-password',
  wrap(async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password ?? '');

    const check = passwordLoginLimiter(`${req.ip}:${email}`);
    if (!check.ok) throw badRequest('Слишком много попыток. Попробуйте позже.', 'rate_limited');

    const user = userByEmail(email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw badRequest('Неверный email или пароль', 'invalid_credentials');
    }
    if (user.status === 'banned') {
      throw forbidden(`Аккаунт заблокирован: ${user.status_reason || 'нарушение правил'}`);
    }

    const token = createSession(user.id, req.get('user-agent') || '');
    setSessionCookie(res, token);
    res.json({ ok: true, user: privateUser(user), needsProfile: !user.username });
  }),
);

/** POST /api/auth/profile — завершение регистрации: никнейм и имя. */
router.post(
  '/profile',
  requireSession,
  wrap(async (req, res) => {
    const user = req.user;
    if (user.username) throw badRequest('Профиль уже создан');

    const username = normalizeUsername(req.body?.username);
    if (RESERVED_USERNAMES.has(username)) throw badRequest('Этот никнейм зарезервирован');
    if (userByUsername(username)) throw badRequest('Никнейм уже занят', 'username_taken');

    const displayName =
      text(req.body?.displayName, { max: LIMITS.displayName, field: 'Отображаемое имя' }) || username;

    run(
      `UPDATE users SET username = $username, display_name = $displayName, updated_at = $now
       WHERE id = $id`,
      { username, displayName, id: user.id, now: nowIso() },
    );

    notify({
      userId: user.id,
      type: 'system',
      title: 'Добро пожаловать в ThePrompt!',
      body: 'Опубликуйте свой первый промпт и подпишитесь на интересных авторов.',
      link: '/compose',
    });

    res.json({ ok: true, user: privateUser(get('SELECT * FROM users WHERE id = $id', { id: user.id })) });
  }),
);

/** GET /api/auth/me — текущий пользователь. */
router.get('/me', (req, res) => {
  res.json({ user: req.user ? privateUser(req.user) : null });
});

/** POST /api/auth/logout */
router.post('/logout', (req, res) => {
  destroySession(req.sessionToken);
  clearSessionCookie(res);
  res.json({ ok: true });
});

/** POST /api/auth/logout-all — закрывает все сессии пользователя. */
router.post('/logout-all', requireSession, (req, res) => {
  run('DELETE FROM sessions WHERE user_id = $id', { id: req.user.id });
  clearSessionCookie(res);
  res.json({ ok: true });
});

/** GET /api/auth/username-available?username=… */
router.get(
  '/username-available',
  wrap(async (req, res) => {
    let username;
    try {
      username = normalizeUsername(req.query.username);
    } catch (err) {
      return res.json({ available: false, reason: err.message ?? 'Некорректный никнейм' });
    }
    if (RESERVED_USERNAMES.has(username)) {
      return res.json({ available: false, reason: 'Никнейм зарезервирован' });
    }
    const taken = !!userByUsername(username);
    res.json({ available: !taken, reason: taken ? 'Никнейм занят' : null });
  }),
);

/** Периодическая очистка просроченных кодов и сессий. */
export function cleanupExpired() {
  run('DELETE FROM otp_codes WHERE expires_at < $now', { now: nowIso() });
  run('DELETE FROM sessions WHERE expires_at < $now', { now: nowIso() });
}
