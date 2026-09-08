import { config } from './config.js';
import { get, run } from './db.js';
import { forbidden, isoPlus, nowIso, randomToken, unauthorized } from './util.js';

const SESSION_TTL_MS = config.session.ttlDays * 24 * 60 * 60 * 1000;

export function createSession(userId, userAgent = '') {
  const token = randomToken(32);
  run(
    `INSERT INTO sessions (token, user_id, user_agent, expires_at)
     VALUES ($token, $userId, $userAgent, $expiresAt)`,
    {
      token,
      userId,
      userAgent: String(userAgent).slice(0, 200),
      expiresAt: isoPlus(SESSION_TTL_MS),
    },
  );
  return token;
}

export function destroySession(token) {
  if (token) run('DELETE FROM sessions WHERE token = $token', { token });
}

export function setSessionCookie(res, token) {
  res.cookie(config.session.cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(config.session.cookieName, { path: '/' });
}

export function userBySession(token) {
  if (!token) return null;
  const row = get(
    `SELECT u.* FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = $token AND s.expires_at > $now`,
    { token, now: nowIso() },
  );
  return row;
}

/** Кладёт текущего пользователя в req.user (или null). */
export function attachUser(req, _res, next) {
  const token = req.cookies?.[config.session.cookieName];
  req.sessionToken = token || null;
  req.user = userBySession(token);
  next();
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthorized());
  if (!req.user.username) {
    return next(forbidden('Сначала завершите создание профиля'));
  }
  if (req.user.status === 'banned') {
    return next(forbidden(`Аккаунт заблокирован: ${req.user.status_reason || 'нарушение правил'}`));
  }
  next();
}

/** Пользователь вошёл, но профиль может быть ещё не создан. */
export function requireSession(req, _res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

export function requireAdmin(req, _res, next) {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== 'admin') return next(forbidden('Раздел доступен только администраторам'));
  next();
}
