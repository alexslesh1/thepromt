/**
 * Общий модуль OAuth2 (Authorization Code) для входа через сторонние сервисы.
 *
 * Настоящие, публично документированные consumer-провайдеры — GitHub,
 * Google, Microsoft, Discord: у них есть стандартный OAuth2-флоу для
 * сторонних приложений, и модуль умеет с ними работать, если в .env заданы
 * CLIENT_ID/CLIENT_SECRET.
 *
 * OpenAI (ChatGPT) и Anthropic (Claude) в список провайдеров ниже не входят
 * намеренно: у них нет публичного OAuth «Войти через ChatGPT/Claude» для
 * сторонних сайтов. Кнопки для них в интерфейсе есть (по ТЗ), но при клике
 * честно показывают объяснение вместо фиктивного входа.
 */
import { config } from './config.js';

/** @typedef {{id: string, name: string, authorizeUrl: string, tokenUrl: string, scope: string, userInfoUrl: string, extractProfile: (json: any, tokenJson: any) => {id: string, email: string|null, displayName: string, avatarUrl: string|null}}} OAuthProvider */

/** @type {Record<string, OAuthProvider>} */
export const PROVIDERS = {
  github: {
    id: 'github',
    name: 'GitHub',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    scope: 'read:user user:email',
    async extractProfile(profile, _token, fetchImpl) {
      let email = profile.email;
      if (!email) {
        // Приватный email нужно запрашивать отдельным эндпоинтом.
        try {
          const res = await fetchImpl('https://api.github.com/user/emails', {
            headers: { Authorization: `Bearer ${_token.access_token}`, 'User-Agent': 'ThePrompt' },
          });
          if (res.ok) {
            const emails = await res.json();
            email = emails.find((e) => e.primary && e.verified)?.email ?? emails[0]?.email ?? null;
          }
        } catch {
          /* без email тоже можно завести аккаунт — см. ниже */
        }
      }
      return {
        id: String(profile.id),
        email,
        displayName: profile.name || profile.login,
        avatarUrl: profile.avatar_url || null,
      };
    },
  },
  google: {
    id: 'google',
    name: 'Google',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
    scope: 'openid email profile',
    extractProfile: (profile) => ({
      id: String(profile.sub),
      email: profile.email || null,
      displayName: profile.name || profile.email,
      avatarUrl: profile.picture || null,
    }),
  },
  microsoft: {
    id: 'microsoft',
    name: 'Microsoft',
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    userInfoUrl: 'https://graph.microsoft.com/oidc/userinfo',
    scope: 'openid email profile',
    extractProfile: (profile) => ({
      id: String(profile.sub),
      email: profile.email || null,
      displayName: profile.name || profile.email,
      avatarUrl: null,
    }),
  },
  discord: {
    id: 'discord',
    name: 'Discord',
    authorizeUrl: 'https://discord.com/api/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    userInfoUrl: 'https://discord.com/api/users/@me',
    scope: 'identify email',
    extractProfile: (profile) => ({
      id: String(profile.id),
      email: profile.email || null,
      displayName: profile.global_name || profile.username,
      avatarUrl: profile.avatar
        ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png`
        : null,
    }),
  },
};

/** Провайдеры без реального consumer OAuth — только для честного UI-сообщения. */
export const UNAVAILABLE_PROVIDERS = {
  openai: {
    id: 'openai',
    name: 'ChatGPT (OpenAI)',
    reason: 'У OpenAI нет публичного OAuth «Войти через ChatGPT» для сторонних сайтов — эта кнопка декоративная.',
  },
  anthropic: {
    id: 'anthropic',
    name: 'Claude (Anthropic)',
    reason: 'У Anthropic нет публичного OAuth «Войти через Claude» для сторонних сайтов — эта кнопка декоративная.',
  },
};

export function providerConfig(providerId) {
  return config.oauth[providerId] ?? null;
}

export function isProviderConfigured(providerId) {
  const cfg = providerConfig(providerId);
  return !!(cfg?.clientId && cfg?.clientSecret);
}

export function redirectUri(providerId) {
  return `${config.appUrl}/api/auth/oauth/${providerId}/callback`;
}

export function buildAuthorizeUrl(providerId, state) {
  const provider = PROVIDERS[providerId];
  const cfg = providerConfig(providerId);
  const url = new URL(provider.authorizeUrl);
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('redirect_uri', redirectUri(providerId));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', provider.scope);
  url.searchParams.set('state', state);
  if (providerId === 'discord') url.searchParams.set('prompt', 'consent');
  return url.toString();
}

/** Обменивает code на access_token и достаёт профиль пользователя. */
export async function completeOAuthLogin(providerId, code) {
  const provider = PROVIDERS[providerId];
  const cfg = providerConfig(providerId);

  const tokenRes = await fetch(provider.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code,
      redirect_uri: redirectUri(providerId),
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) {
    throw new Error(`Провайдер отклонил обмен кода (${tokenRes.status})`);
  }
  const tokenJson = await tokenRes.json();
  if (!tokenJson.access_token) {
    throw new Error(tokenJson.error_description || 'Провайдер не вернул access_token');
  }

  const profileRes = await fetch(provider.userInfoUrl, {
    headers: { Authorization: `Bearer ${tokenJson.access_token}`, 'User-Agent': 'ThePrompt' },
  });
  if (!profileRes.ok) {
    throw new Error(`Не удалось получить профиль пользователя (${profileRes.status})`);
  }
  const profileJson = await profileRes.json();
  const profile = await provider.extractProfile(profileJson, tokenJson, fetch);
  return profile;
}
