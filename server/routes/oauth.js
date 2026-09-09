/**
 * Вход через сторонние сервисы (OAuth2 Authorization Code).
 *
 * /start редиректит на провайдера, /callback принимает код, заводит или
 * находит локального пользователя и открывает обычную сессию — дальше всё
 * работает так же, как после входа по email-коду.
 */
import express from 'express';
import { config } from '../config.js';
import { get, run } from '../db.js';
import { createSession, setSessionCookie } from '../auth.js';
import { findOrCreateUserByEmail, notify, userById } from '../store.js';
import {
  PROVIDERS,
  UNAVAILABLE_PROVIDERS,
  buildAuthorizeUrl,
  completeOAuthLogin,
  isProviderConfigured,
} from '../oauth.js';
import { isoPlus, nowIso, randomToken, wrap } from '../util.js';

export const router = express.Router();

const STATE_TTL_MS = 10 * 60 * 1000;

/** GET /api/auth/oauth/providers — какие кнопки показывать и в каком состоянии. */
router.get('/providers', (_req, res) => {
  const available = Object.values(PROVIDERS).map((p) => ({
    id: p.id,
    name: p.name,
    configured: isProviderConfigured(p.id),
  }));
  const unavailable = Object.values(UNAVAILABLE_PROVIDERS).map((p) => ({
    id: p.id,
    name: p.name,
    configured: false,
    reason: p.reason,
  }));
  res.json({ providers: [...available, ...unavailable] });
});

/** GET /api/auth/oauth/:provider/start — редирект на страницу авторизации провайдера. */
router.get(
  '/:provider/start',
  wrap(async (req, res) => {
    const providerId = req.params.provider;
    if (UNAVAILABLE_PROVIDERS[providerId]) {
      return res.redirect(
        `/?oauthError=${encodeURIComponent(UNAVAILABLE_PROVIDERS[providerId].reason)}`,
      );
    }
    if (!PROVIDERS[providerId] || !isProviderConfigured(providerId)) {
      return res.redirect(
        `/?oauthError=${encodeURIComponent('Этот способ входа пока не настроен на сервере.')}`,
      );
    }

    const state = randomToken(24);
    run(
      `INSERT INTO oauth_states (state, provider, expires_at) VALUES ($state, $provider, $expiresAt)`,
      { state, provider: providerId, expiresAt: isoPlus(STATE_TTL_MS) },
    );
    res.redirect(buildAuthorizeUrl(providerId, state));
  }),
);

/** GET /api/auth/oauth/:provider/callback */
router.get(
  '/:provider/callback',
  wrap(async (req, res) => {
    const providerId = req.params.provider;
    const fail = (message) => res.redirect(`/?oauthError=${encodeURIComponent(message)}`);

    if (!PROVIDERS[providerId] || !isProviderConfigured(providerId)) {
      return fail('Этот способ входа пока не настроен на сервере.');
    }
    if (req.query.error) {
      return fail('Вход отменён.');
    }

    const state = String(req.query.state ?? '');
    const record = get(
      `SELECT * FROM oauth_states WHERE state = $state AND provider = $provider AND expires_at > $now`,
      { state, provider: providerId, now: nowIso() },
    );
    run('DELETE FROM oauth_states WHERE state = $state', { state });
    if (!record) return fail('Сессия входа истекла, попробуйте ещё раз.');

    const code = String(req.query.code ?? '');
    if (!code) return fail('Провайдер не прислал код авторизации.');

    let profile;
    try {
      profile = await completeOAuthLogin(providerId, code);
    } catch (error) {
      return fail(error.message || 'Не удалось войти через этот сервис.');
    }

    const existingLink = get(
      `SELECT * FROM oauth_accounts WHERE provider = $provider AND provider_user_id = $pid`,
      { provider: providerId, pid: profile.id },
    );

    let user;
    if (existingLink) {
      user = userById(existingLink.user_id);
      if (!user) return fail('Аккаунт не найден.');
    } else {
      // Синтетический email для провайдеров без публичного адреса (например,
      // закрытый GitHub email) — вход всё равно работает, просто без письма.
      const email = profile.email || `${providerId}.${profile.id}@oauth.theprompt.local`;
      const isNewAccount = !get('SELECT 1 AS x FROM users WHERE email = $email', { email });

      user = findOrCreateUserByEmail(email, { adminEmails: config.adminEmails });
      run(
        `INSERT INTO oauth_accounts (user_id, provider, provider_user_id, email, display_name, avatar_url)
         VALUES ($userId, $provider, $pid, $email, $displayName, $avatarUrl)`,
        {
          userId: user.id,
          provider: providerId,
          pid: profile.id,
          email: profile.email,
          displayName: profile.displayName,
          avatarUrl: profile.avatarUrl,
        },
      );

      // Свежему аккаунту заполняем аватар из профиля провайдера — но только
      // при первом заведении: в остальных случаях не перезаписываем то, что
      // пользователь мог уже настроить сам.
      if (isNewAccount && profile.avatarUrl && !user.avatar_url) {
        run('UPDATE users SET avatar_url = $url WHERE id = $id', { url: profile.avatarUrl, id: user.id });
        user = userById(user.id);
      }
    }

    if (user.status === 'banned') {
      return fail(`Аккаунт заблокирован: ${user.status_reason || 'нарушение правил'}`);
    }

    if (!user.username) {
      notify({
        userId: user.id,
        type: 'system',
        title: 'Добро пожаловать в ThePrompt!',
        body: 'Вы вошли через ' + (PROVIDERS[providerId]?.name ?? providerId) + '. Завершите настройку профиля.',
        link: '/settings',
      });
    }

    const token = createSession(user.id, req.get('user-agent') || '');
    setSessionCookie(res, token);
    res.redirect('/');
  }),
);
