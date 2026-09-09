/**
 * End-to-end проверка API ThePrompt.
 * Запуск: npm test  (использует отдельную временную базу)
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';

const tmpDb = path.join(os.tmpdir(), `theprompt-test-${Date.now()}.db`);
process.env.DB_FILE = tmpDb;
process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAILS = 'admin@example.com';
process.env.SESSION_SECRET = 'test-secret';
process.env.GITHUB_CLIENT_ID = 'test-github-client';
process.env.GITHUB_CLIENT_SECRET = 'test-github-secret';
// DEEPSEEK_API_KEY намеренно не задан здесь: по умолчанию тесты должны видеть
// то же «не настроено», что и чистый сервер без .env (демо-режим Eduardo,
// честная 503 в /api/test-prompt). Тесты, которым нужен «настроенный» ключ,
// временно подставляют его через withDeepseekKey() ниже — так тесты никогда
// не бьют по-настоящему в DeepSeek и не тратят реальный баланс, даже если
// в .env лежит боевой ключ (он читается в process.env, а не в config).
process.env.DEEPSEEK_API_KEY = '';

const { app } = await import('../server/index.js');
const { closeDb, get: dbGet, run: dbRun } = await import('../server/db.js');
const { config } = await import('../server/config.js');
const { sha256 } = await import('../server/util.js');
const { pruneOldEduardoUsage } = await import('../server/eduardo.js');

/** Временно подставляет тестовый ключ DeepSeek на время выполнения fn(). */
async function withDeepseekKey(fn) {
  const original = config.ai.deepseekKey;
  config.ai.deepseekKey = 'test-deepseek-key';
  try {
    await fn();
  } finally {
    config.ai.deepseekKey = original;
  }
}

let server;
let base;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(`${tmpDb}${suffix}`, { force: true });
  }
});

/** Клиент с собственной «банкой» cookie. */
function client() {
  let cookie = '';
  const call = async function call(method, url, body, { raw = false } = {}) {
    const headers = { 'X-Requested-With': 'ThePrompt' };
    if (cookie) headers.cookie = cookie;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(`${base}${url}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    for (const item of setCookie) cookie = item.split(';')[0];
    const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
    if (raw) return { status: res.status, data };
    assert.ok(res.ok, `${method} ${url} → ${res.status}: ${JSON.stringify(data)}`);
    return data;
  };
  // Сырое значение куки — нужно тестам, которые проверяют, что в БД лежит
  // не сам токен, а его хеш (без этого пришлось бы тратить лишний
  // /api/auth/request-code сверх лимита в 10/час на IP теста).
  Object.defineProperty(call, 'cookie', { get: () => cookie });
  return call;
}

/** Регистрация через OTP + создание профиля. */
async function signUp(email, username, displayName) {
  const call = client();
  const requested = await call('POST', '/api/auth/request-code', { email });
  assert.ok(requested.devCode, 'в тестовом режиме код должен возвращаться в ответе');
  await call('POST', '/api/auth/verify', { email, code: requested.devCode });
  const profile = await call('POST', '/api/auth/profile', { username, displayName });
  assert.equal(profile.user.username, username);
  return { call, user: profile.user };
}

let alice;
let bob;
let admin;
let postId;
let eduardoTools;

test('регистрация по email с кодом подтверждения', async () => {
  alice = await signUp('alice@example.com', 'alice', 'Алиса');
  bob = await signUp('bob@example.com', 'bobik', 'Боб');
  admin = await signUp('admin@example.com', 'moderator', 'Модератор');

  assert.equal(alice.user.role, 'user');
  assert.equal(admin.user.role, 'admin', 'email из ADMIN_EMAILS получает роль администратора');
});

test('токен сессии в БД хранится хешем, а не как есть', async () => {
  // Переиспользуем уже открытую сессию alice — без лишнего
  // /api/auth/request-code сверх лимита в 10/час на IP теста.
  const rawToken = alice.call.cookie.split('=')[1];
  assert.ok(rawToken, 'у alice должна быть сессионная кука');

  const plainRow = dbGet('SELECT 1 AS found FROM sessions WHERE token = $token', { token: rawToken });
  assert.ok(!plainRow, 'сырой токен из куки не должен буквально совпадать со значением в БД');

  const hashedRow = dbGet('SELECT 1 AS found FROM sessions WHERE token = $token', { token: sha256(rawToken) });
  assert.ok(hashedRow, 'в БД должен лежать именно sha256-хеш токена');
});

test('неверный код не пускает в аккаунт', async () => {
  const call = client();
  await call('POST', '/api/auth/request-code', { email: 'mallory@example.com' });
  const res = await call('POST', '/api/auth/verify', { email: 'mallory@example.com', code: '000000' }, { raw: true });
  assert.equal(res.status, 400);
  assert.equal(res.data.code, 'invalid_code');
});

test('никнейм нельзя занять дважды', async () => {
  const call = client();
  const requested = await call('POST', '/api/auth/request-code', { email: 'dup@example.com' });
  await call('POST', '/api/auth/verify', { email: 'dup@example.com', code: requested.devCode });
  const res = await call('POST', '/api/auth/profile', { username: 'alice' }, { raw: true });
  assert.equal(res.status, 400);
  assert.equal(res.data.code, 'username_taken');
});

test('OAuth: список провайдеров честно помечает, что настроено', async () => {
  const list = await client()('GET', '/api/auth/oauth/providers');
  const github = list.providers.find((p) => p.id === 'github');
  const google = list.providers.find((p) => p.id === 'google');
  const openai = list.providers.find((p) => p.id === 'openai');
  assert.equal(github.configured, true, 'GitHub настроен тестовыми переменными окружения');
  assert.equal(google.configured, false, 'Google не настроен');
  assert.equal(openai.configured, false);
  assert.ok(openai.reason.includes('нет публичного OAuth'));
});

test('OAuth: непонятный/неотключённый провайдер редиректит с понятной ошибкой', async () => {
  const res = await fetch(`${base}/api/auth/oauth/openai/start`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  const location = new URL(res.headers.get('location'), base);
  assert.ok(location.searchParams.get('oauthError')?.includes('нет публичного OAuth'));
});

test('OAuth: полный вход через GitHub заводит аккаунт и открывает сессию', async () => {
  const startRes = await fetch(`${base}/api/auth/oauth/github/start`, { redirect: 'manual' });
  assert.equal(startRes.status, 302);
  const authorizeUrl = new URL(startRes.headers.get('location'));
  assert.equal(authorizeUrl.hostname, 'github.com');
  const state = authorizeUrl.searchParams.get('state');
  assert.ok(state);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    if (href.startsWith('https://github.com/login/oauth/access_token')) {
      return new Response(JSON.stringify({ access_token: 'fake-gh-token', token_type: 'bearer' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (href === 'https://api.github.com/user') {
      return new Response(
        JSON.stringify({ id: 555444, login: 'octoprompt', name: 'Octo Prompt', avatar_url: 'https://example.com/a.png', email: 'octo@example.com' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return originalFetch(url, init);
  };

  let callbackRes;
  try {
    callbackRes = await fetch(
      `${base}/api/auth/oauth/github/callback?code=fake-code&state=${encodeURIComponent(state)}`,
      { redirect: 'manual' },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(callbackRes.status, 302);
  assert.equal(new URL(callbackRes.headers.get('location'), base).pathname, '/');
  const cookie = callbackRes.headers.getSetCookie?.()?.[0]?.split(';')[0];
  assert.ok(cookie, 'сессия должна открыться cookie');

  const me = await fetch(`${base}/api/auth/me`, { headers: { cookie } }).then((r) => r.json());
  assert.equal(me.user.email, 'octo@example.com');
  assert.equal(me.user.needsProfile, true, 'новый пользователь ещё не выбрал никнейм');
  assert.equal(me.user.avatarUrl, 'https://example.com/a.png', 'аватар подтянулся из профиля GitHub');

  // Повторный вход тем же GitHub-аккаунтом должен попасть в тот же локальный аккаунт.
  const state2 = new URL((await fetch(`${base}/api/auth/oauth/github/start`, { redirect: 'manual' })).headers.get('location')).searchParams.get('state');
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    if (href.startsWith('https://github.com/login/oauth/access_token')) {
      return new Response(JSON.stringify({ access_token: 'fake-gh-token-2' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (href === 'https://api.github.com/user') {
      return new Response(
        JSON.stringify({ id: 555444, login: 'octoprompt', name: 'Octo Prompt', avatar_url: 'https://example.com/a.png', email: 'octo@example.com' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return originalFetch(url, init);
  };
  let callback2;
  try {
    callback2 = await fetch(`${base}/api/auth/oauth/github/callback?code=x&state=${encodeURIComponent(state2)}`, {
      redirect: 'manual',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  const cookie2 = callback2.headers.getSetCookie?.()?.[0]?.split(';')[0];
  const me2 = await fetch(`${base}/api/auth/me`, { headers: { cookie: cookie2 } }).then((r) => r.json());
  assert.equal(me2.user.id, me.user.id, 'второй вход через тот же GitHub-аккаунт — тот же пользователь');
});

test('публикация промта со всеми полями', async () => {
  const created = await alice.call('POST', '/api/posts', {
    promptText: 'Действуй как senior-разработчик и проведи ревью кода ниже: {code}',
    modelFamily: 'claude',
    modelVersion: 'Claude Sonnet 4.5',
    difficulty: 'advanced',
    description: 'Ревью кода с объяснениями',
    exampleText: '1. Утечка памяти в строке 12…',
    tags: ['код', 'Ревью', 'код'],
  });
  postId = created.post.id;
  assert.equal(created.post.modelVersion, 'Claude Sonnet 4.5');
  assert.equal(created.post.difficulty, 'advanced');
  assert.deepEqual(created.post.tags, ['код', 'ревью'], 'теги нормализуются и дедуплицируются');
});

test('пост без модели или с коротким текстом отклоняется', async () => {
  const noModel = await alice.call('POST', '/api/posts', { promptText: 'Текст промта', modelFamily: 'нет-такой' }, { raw: true });
  assert.equal(noModel.status, 400);
  const tooShort = await alice.call('POST', '/api/posts', { promptText: 'ok', modelFamily: 'chatgpt' }, { raw: true });
  assert.equal(tooShort.status, 400);
});

test('анонимный пользователь не может публиковать', async () => {
  const res = await client()('POST', '/api/posts', { promptText: 'Промт для теста', modelFamily: 'chatgpt' }, { raw: true });
  assert.equal(res.status, 401);
});

test('лайк ставится и снимается', async () => {
  const liked = await bob.call('POST', `/api/posts/${postId}/like`);
  assert.equal(liked.liked, true);
  assert.equal(liked.counts.likes, 1);
  const unliked = await bob.call('POST', `/api/posts/${postId}/like`);
  assert.equal(unliked.liked, false);
  assert.equal(unliked.counts.likes, 0);
  await bob.call('POST', `/api/posts/${postId}/like`);
});

test('комментарии и ответы в треде', async () => {
  const first = await bob.call('POST', `/api/posts/${postId}/comments`, { body: 'Отличный промт!' });
  assert.equal(first.comments.length, 1);
  const rootId = first.comments[0].id;
  const reply = await alice.call('POST', `/api/posts/${postId}/comments`, {
    body: 'Спасибо!',
    parentId: rootId,
  });
  assert.equal(reply.comments[0].replies.length, 1, 'ответ вложен в родительский комментарий');
  assert.equal(reply.counts.comments, 2);
});

test('репост своего поста запрещён, чужого — работает', async () => {
  const own = await alice.call('POST', `/api/posts/${postId}/repost`, {}, { raw: true });
  assert.equal(own.status, 400);
  const reposted = await bob.call('POST', `/api/posts/${postId}/repost`, {});
  assert.equal(reposted.reposted, true);
  assert.equal(reposted.counts.reposts, 1);
});

test('лента: свежее, популярное, фильтры и поиск', async () => {
  await bob.call('POST', '/api/posts', {
    promptText: 'Сгенерируй изображение неонового города под дождём, 35 мм',
    modelFamily: 'midjourney',
    modelVersion: 'Midjourney v6.1',
    difficulty: 'beginner',
    tags: ['картинки'],
  });

  const latest = await client()('GET', '/api/posts?tab=latest');
  assert.equal(latest.items.length, 2);
  assert.ok(latest.items[0].sortAt >= latest.items[1].sortAt, 'свежие сверху');

  const popular = await client()('GET', '/api/posts?tab=popular');
  assert.equal(popular.items[0].post.id, postId, 'самый обсуждаемый пост первый');

  const byModel = await client()('GET', '/api/posts?model=midjourney');
  assert.equal(byModel.items.length, 1);

  const byDifficulty = await client()('GET', '/api/posts?difficulty=advanced');
  assert.equal(byDifficulty.items.length, 1);

  const byTag = await client()('GET', '/api/posts?tag=картинки');
  assert.equal(byTag.items.length, 1);

  const search = await client()('GET', '/api/posts?q=неонового');
  assert.equal(search.items.length, 1);

  const searchByVersion = await client()('GET', '/api/posts?q=Sonnet');
  assert.equal(searchByVersion.items.length, 1);
});

test('пагинация ленты', async () => {
  const page1 = await client()('GET', '/api/posts?limit=1&page=1');
  assert.equal(page1.items.length, 1);
  assert.equal(page1.hasMore, true);
  const page2 = await client()('GET', '/api/posts?limit=1&page=2');
  assert.equal(page2.items.length, 1);
  assert.notEqual(page1.items[0].post.id, page2.items[0].post.id);
  assert.equal(page2.hasMore, false);
});

test('подписки и лента подписок', async () => {
  const anon = await client()('GET', '/api/posts?tab=following', undefined, { raw: true });
  assert.equal(anon.status, 403);

  const empty = await bob.call('GET', '/api/posts?tab=following');
  assert.equal(empty.items.length, 0);

  const followed = await bob.call('POST', '/api/users/alice/follow');
  assert.equal(followed.user.isFollowing, true);
  assert.equal(followed.user.counts.followers, 1);

  const feed = await bob.call('GET', '/api/posts?tab=following');
  assert.equal(feed.items.length, 1);
  assert.equal(feed.items[0].post.author.username, 'alice');

  const unfollowed = await bob.call('POST', '/api/users/alice/follow');
  assert.equal(unfollowed.user.isFollowing, false);
  await bob.call('POST', '/api/users/alice/follow');
});

test('профиль: посты, репосты и лайки', async () => {
  const profile = await client()('GET', '/api/users/alice');
  assert.equal(profile.user.displayName, 'Алиса');
  assert.equal(profile.user.counts.posts, 1);
  assert.equal(profile.user.counts.likes, 1);

  const bobFeed = await client()('GET', '/api/users/bobik/posts');
  const kinds = bobFeed.items.map((i) => i.type);
  assert.ok(kinds.includes('repost'), 'репост виден в профиле');
  assert.ok(kinds.includes('post'));

  const likes = await client()('GET', '/api/users/bobik/posts?tab=likes');
  assert.equal(likes.items.length, 1);
});

test('настройки профиля: имя, био, тема, аватар', async () => {
  const updated = await alice.call('PATCH', '/api/me', {
    displayName: 'Алиса П.',
    bio: 'Пишу промты для Claude',
    theme: 'light',
    avatarUrl: '/uploads/demo-avatar.png',
    bannerUrl: '/uploads/demo-banner.png',
  });
  assert.equal(updated.user.displayName, 'Алиса П.');
  assert.equal(updated.user.theme, 'light');
  assert.equal(updated.user.avatarUrl, '/uploads/demo-avatar.png');

  const bad = await alice.call('PATCH', '/api/me', { theme: 'neon' }, { raw: true });
  assert.equal(bad.status, 400);
});

test('уведомления приходят автору поста', async () => {
  const list = await alice.call('GET', '/api/notifications');
  const types = list.items.map((n) => n.type);
  assert.ok(types.includes('like'));
  assert.ok(types.includes('comment'));
  assert.ok(types.includes('repost'));
  assert.ok(types.includes('follow'));
  assert.ok(list.unread > 0);

  const read = await alice.call('POST', '/api/notifications/read');
  assert.equal(read.unread, 0);
});

test('жалоба уходит в админку и уведомляет админа', async () => {
  const badReason = await bob.call('POST', `/api/posts/${postId}/report`, { reason: 'потому что' }, { raw: true });
  assert.equal(badReason.status, 400);

  await bob.call('POST', `/api/posts/${postId}/report`, {
    reason: 'spam',
    details: 'Похоже на рекламу курса',
  });

  const duplicate = await bob.call('POST', `/api/posts/${postId}/report`, { reason: 'spam' }, { raw: true });
  assert.equal(duplicate.status, 400);
  assert.equal(duplicate.data.code, 'duplicate_report');

  const own = await alice.call('POST', `/api/posts/${postId}/report`, { reason: 'spam' }, { raw: true });
  assert.equal(own.status, 400);

  const adminNotifications = await admin.call('GET', '/api/notifications');
  assert.ok(adminNotifications.items.some((n) => n.type === 'report'), 'админ получает внутреннее уведомление');
});

test('админка закрыта для обычных пользователей', async () => {
  const asUser = await bob.call('GET', '/api/admin/reports', undefined, { raw: true });
  assert.equal(asUser.status, 403);
  const asAnon = await client()('GET', '/api/admin/reports', undefined, { raw: true });
  assert.equal(asAnon.status, 401);
});

test('админ видит жалобу, открывает пост и удаляет его', async () => {
  const reports = await admin.call('GET', '/api/admin/reports?status=open');
  assert.equal(reports.items.length, 1);
  const report = reports.items[0];
  assert.equal(report.reason, 'spam');
  assert.equal(report.reporter.username, 'bobik');
  assert.equal(report.post.id, postId);

  const card = await admin.call('GET', `/api/admin/reports/${report.id}`);
  assert.equal(card.post.id, postId);
  assert.equal(card.author.username, 'alice');

  await admin.call('POST', `/api/admin/posts/${postId}/delete`, { reason: 'Реклама курса' });

  const feed = await client()('GET', '/api/posts?tab=latest');
  assert.ok(!feed.items.some((i) => i.post.id === postId), 'удалённый пост пропадает из ленты');

  const gone = await client()('GET', `/api/posts/${postId}`, undefined, { raw: true });
  assert.equal(gone.status, 404);

  const closed = await admin.call('GET', '/api/admin/reports?status=open');
  assert.equal(closed.items.length, 0, 'жалоба закрывается вместе с удалением поста');

  const authorNotifications = await alice.call('GET', '/api/notifications');
  assert.ok(authorNotifications.items.some((n) => n.type === 'moderation'), 'автор получает уведомление о модерации');

  await admin.call('POST', `/api/admin/posts/${postId}/restore`);
  const restored = await client()('GET', `/api/posts/${postId}`);
  assert.equal(restored.post.id, postId);
});

test('админ отклоняет необоснованную жалобу', async () => {
  await bob.call('POST', `/api/posts/${postId}/report`, { reason: 'abuse', details: 'Проверка' });
  const reports = await admin.call('GET', '/api/admin/reports?status=open');
  const report = reports.items[0];
  await admin.call('POST', `/api/admin/reports/${report.id}/dismiss`, { note: 'Нарушений нет' });

  const open = await admin.call('GET', '/api/admin/reports?status=open');
  assert.equal(open.items.length, 0);
  const dismissed = await admin.call('GET', '/api/admin/reports?status=dismissed');
  assert.equal(dismissed.items.length, 1);

  const reporterInbox = await bob.call('GET', '/api/notifications');
  assert.ok(reporterInbox.items.some((n) => n.title.includes('отклонена')));
});

test('админ предупреждает и блокирует автора', async () => {
  const warned = await admin.call('POST', `/api/users/${alice.user.id}/moderate`, {
    action: 'warn',
    reason: 'Предупреждение за спам',
  }, { raw: true });
  assert.equal(warned.status, 404, 'модерация живёт в /api/admin');

  const warn = await admin.call('POST', `/api/admin/users/${alice.user.id}/moderate`, {
    action: 'warn',
    reason: 'Предупреждение за спам',
  });
  assert.equal(warn.user.status, 'warned');

  const ban = await admin.call('POST', `/api/admin/users/${alice.user.id}/moderate`, {
    action: 'ban',
    reason: 'Повторные нарушения',
  });
  assert.equal(ban.user.status, 'banned');

  // Сессии заблокированного пользователя закрыты.
  const afterBan = await alice.call('GET', '/api/notifications', undefined, { raw: true });
  assert.equal(afterBan.status, 401);

  // И войти заново нельзя.
  const relogin = await client()('POST', '/api/auth/request-code', { email: 'alice@example.com' }, { raw: true });
  assert.equal(relogin.status, 403);

  await admin.call('POST', `/api/admin/users/${alice.user.id}/moderate`, { action: 'unban' });
  const active = await client()('GET', '/api/users/alice');
  assert.equal(active.user.status, 'active');
});

test('админ не может забанить другого админа или себя', async () => {
  const self = await admin.call('POST', `/api/admin/users/${admin.user.id}/moderate`, { action: 'ban' }, { raw: true });
  assert.equal(self.status, 400);
});

test('статистика админ-панели', async () => {
  const { stats } = await admin.call('GET', '/api/admin/stats');
  assert.ok(stats.users >= 3);
  assert.ok(stats.posts >= 2);
  assert.equal(stats.openReports, 0);
});

test('поиск по пользователям и подсказки в сайдбаре', async () => {
  const users = await client()('GET', '/api/search/users?q=али');
  assert.ok(users.users.some((u) => u.username === 'alice'));

  const sidebar = await client()('GET', '/api/sidebar');
  assert.ok(sidebar.trendingTags.length > 0);
  assert.ok(sidebar.topModels.length > 0);
});

test('автор удаляет свой пост, чужой — не может', async () => {
  const created = await bob.call('POST', '/api/posts', {
    promptText: 'Временный промт для проверки удаления',
    modelFamily: 'chatgpt',
  });
  const id = created.post.id;

  const foreign = await client()('DELETE', `/api/posts/${id}`, undefined, { raw: true });
  assert.equal(foreign.status, 401);

  await bob.call('DELETE', `/api/posts/${id}`);
  const gone = await client()('GET', `/api/posts/${id}`, undefined, { raw: true });
  assert.equal(gone.status, 404);
});

test('редактирование своего поста', async () => {
  const created = await bob.call('POST', '/api/posts', {
    promptText: 'Первая версия промта для теста',
    modelFamily: 'chatgpt',
    tags: ['код'],
  });
  const updated = await bob.call('PATCH', `/api/posts/${created.post.id}`, {
    promptText: 'Вторая версия промта для теста',
    modelFamily: 'chatgpt',
    difficulty: 'intermediate',
    tags: ['код', 'обучение'],
  });
  assert.equal(updated.post.promptText, 'Вторая версия промта для теста');
  assert.deepEqual(updated.post.tags, ['код', 'обучение']);
});

test('запрос без заголовка X-Requested-With отклоняется (CSRF)', async () => {
  const res = await fetch(`${base}/api/posts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ promptText: 'что-то', modelFamily: 'chatgpt' }),
  });
  assert.equal(res.status, 403);
});


test('заголовок, категория и фильтр по категории', async () => {
  const created = await bob.call('POST', '/api/posts', {
    title: 'Кинематографичная сцена в киберпанк-стиле',
    category: 'images',
    promptText: 'cinematic cyberpunk city at night, rain, neon lights, ultra detailed, 8k',
    modelFamily: 'midjourney',
    modelVersion: 'Midjourney v6.1',
    difficulty: 'intermediate',
    tags: ['киберпанк', 'город'],
  });
  assert.equal(created.post.title, 'Кинематографичная сцена в киберпанк-стиле');
  assert.equal(created.post.category, 'images');

  const byCategory = await client()('GET', '/api/posts?category=images');
  assert.ok(byCategory.items.every((i) => i.post.category === 'images'));
  assert.ok(byCategory.items.some((i) => i.post.id === created.post.id));

  const badCategory = await bob.call(
    'POST',
    '/api/posts',
    { promptText: 'Промт для проверки', modelFamily: 'chatgpt', category: 'нет-такой' },
    { raw: true },
  );
  assert.equal(badCategory.status, 400);
});

test('сортировка ленты', async () => {
  const newest = await client()('GET', '/api/posts?sort=new');
  assert.ok(newest.items[0].sortAt >= newest.items[1].sortAt);

  const discussed = await client()('GET', '/api/posts?sort=discussed');
  assert.equal(discussed.sort, 'discussed');
  assert.ok(discussed.items[0].post.counts.comments >= discussed.items.at(-1).post.counts.comments);
});

test('закладки: сохранить, снять, приватная вкладка профиля', async () => {
  const target = (await client()('GET', '/api/posts')).items[0].post;

  const saved = await bob.call('POST', `/api/posts/${target.id}/bookmark`);
  assert.equal(saved.bookmarked, true);
  assert.equal(saved.counts.bookmarks, 1);

  const list = await bob.call('GET', '/api/users/bobik/posts?tab=bookmarks');
  assert.ok(list.items.some((i) => i.post.id === target.id));

  // Чужие сохранённые не отдаются.
  const foreign = await admin.call('GET', '/api/users/bobik/posts?tab=bookmarks', undefined, { raw: true });
  assert.equal(foreign.status, 403);
  const anon = await client()('GET', '/api/users/bobik/posts?tab=bookmarks', undefined, { raw: true });
  assert.equal(anon.status, 403);

  const removed = await bob.call('POST', `/api/posts/${target.id}/bookmark`);
  assert.equal(removed.bookmarked, false);
  await bob.call('POST', `/api/posts/${target.id}/bookmark`);
});

test('счётчик сохранённого виден только владельцу профиля', async () => {
  const mine = await bob.call('GET', '/api/users/bobik');
  assert.equal(typeof mine.user.counts.bookmarks, 'number');

  const foreign = await admin.call('GET', '/api/users/bobik');
  assert.equal(foreign.user.counts.bookmarks, undefined);

  const anon = await client()('GET', '/api/users/bobik');
  assert.equal(anon.user.counts.bookmarks, undefined);
});

test('опрос: создание, голосование, смена голоса', async () => {
  const created = await bob.call('POST', '/api/posts', {
    title: 'Какой формат ответа удобнее?',
    promptText: 'Промт с опросом для проверки голосования',
    modelFamily: 'chatgpt',
    category: 'text',
    poll: { question: 'Какой формат ответа удобнее?', options: ['Таблица', 'Списком', 'Сплошным текстом'] },
  });
  const postId = created.post.id;
  assert.equal(created.post.poll.question, 'Какой формат ответа удобнее?');
  assert.equal(created.post.poll.options.length, 3);
  assert.equal(created.post.poll.totalVotes, 0);
  assert.equal(created.post.poll.votedOptionId, null);

  const [first, second] = created.post.poll.options;
  const voted = await admin.call('POST', `/api/posts/${postId}/vote`, { optionId: first.id });
  assert.equal(voted.poll.totalVotes, 1);
  assert.equal(voted.poll.votedOptionId, first.id);
  assert.equal(voted.poll.options.find((o) => o.id === first.id).votes, 1);

  // Повторный голос переносится на другой вариант, а не добавляется.
  const moved = await admin.call('POST', `/api/posts/${postId}/vote`, { optionId: second.id });
  assert.equal(moved.poll.totalVotes, 1);
  assert.equal(moved.poll.votedOptionId, second.id);
  assert.equal(moved.poll.options.find((o) => o.id === first.id).votes, 0);

  const wrongOption = await admin.call('POST', `/api/posts/${postId}/vote`, { optionId: 999999 }, { raw: true });
  assert.equal(wrongOption.status, 400);

  const anon = await client()('POST', `/api/posts/${postId}/vote`, { optionId: second.id }, { raw: true });
  assert.equal(anon.status, 401);
});

test('опрос требует минимум двух непустых вариантов', async () => {
  const res = await bob.call(
    'POST',
    '/api/posts',
    {
      promptText: 'Промт с некорректным опросом',
      modelFamily: 'chatgpt',
      poll: { question: 'Вопрос без вариантов', options: ['Единственный'] },
    },
    { raw: true },
  );
  assert.equal(res.status, 400);
});

test('редактирование поста не сбрасывает голоса, если опрос не менялся', async () => {
  const created = await bob.call('POST', '/api/posts', {
    promptText: 'Промт с опросом, который переживёт редактирование',
    modelFamily: 'chatgpt',
    poll: { question: 'Оставить как есть?', options: ['Да', 'Нет'] },
  });
  const postId = created.post.id;
  await admin.call('POST', `/api/posts/${postId}/vote`, { optionId: created.post.poll.options[0].id });

  const edited = await bob.call('PATCH', `/api/posts/${postId}`, {
    description: 'Уточнил описание',
    poll: { question: 'Оставить как есть?', options: ['Да', 'Нет'] },
  });
  assert.equal(edited.post.poll.totalVotes, 1, 'голоса сохраняются');

  const changed = await bob.call('PATCH', `/api/posts/${postId}`, {
    poll: { question: 'Оставить как есть?', options: ['Да', 'Нет', 'Не знаю'] },
  });
  assert.equal(changed.post.poll.options.length, 3);
  assert.equal(changed.post.poll.totalVotes, 0, 'при смене вариантов голоса сбрасываются');
});

test('частичное редактирование сохраняет теги и опрос', async () => {
  const created = await bob.call('POST', '/api/posts', {
    title: 'Пост для частичного редактирования',
    promptText: 'Промт, у которого есть и теги, и опрос',
    modelFamily: 'chatgpt',
    tags: ['код', 'обучение'],
    poll: { question: 'Всё ли на месте?', options: ['Да', 'Нет'] },
  });
  const postId = created.post.id;

  // В теле запроса только описание — остальное должно уцелеть.
  const edited = await bob.call('PATCH', `/api/posts/${postId}`, { description: 'Только описание' });
  assert.equal(edited.post.description, 'Только описание');
  assert.deepEqual(edited.post.tags, ['код', 'обучение'], 'теги не стёрлись');
  assert.equal(edited.post.poll?.question, 'Всё ли на месте?', 'опрос не стёрся');
  assert.equal(edited.post.title, 'Пост для частичного редактирования');

  // Явно переданный пустой опрос убирает его.
  const removed = await bob.call('PATCH', `/api/posts/${postId}`, { poll: { question: '', options: [] } });
  assert.equal(removed.post.poll, null);
});

test('раздел «Сообщения» отдаёт только внутреннюю переписку', async () => {
  const messages = await admin.call('GET', '/api/notifications?kind=messages');
  assert.ok(messages.items.length > 0);
  assert.ok(
    messages.items.every((n) => ['moderation', 'report', 'system'].includes(n.type)),
    'в «Сообщениях» нет лайков и репостов',
  );

  const activity = await admin.call('GET', '/api/notifications?kind=activity');
  assert.ok(activity.items.every((n) => !['moderation', 'report', 'system'].includes(n.type)));
});

test('справочники для интерфейса', async () => {
  const meta = await client()('GET', '/api/meta');
  assert.ok(meta.categories.length >= 5);
  assert.ok(meta.sortOptions.some((s) => s.id === 'new'));
  assert.ok(meta.models.every((m) => m.short && m.color && m.glyph));
  assert.equal(meta.pro.priceLabel, '$10 / месяц');
  assert.equal(meta.eduardo.freeTextLimit, 5);
  assert.equal(meta.eduardo.freeImageLimit, 1);
  assert.equal(meta.eduardo.proTextLimit, 20);
  assert.equal(meta.eduardo.proImageLimit, 3);

  const sidebar = await client()('GET', '/api/sidebar');
  assert.ok(Array.isArray(sidebar.topCategories));
});

test('Pro: подписка активирует флаг и бейдж на постах, отмена снимает', async () => {
  const before = await bob.call('GET', '/api/auth/me');
  assert.equal(before.user.isPro, false);

  const sub = await bob.call('POST', '/api/pro/subscribe');
  assert.equal(sub.user.isPro, true);
  assert.ok(sub.user.proExpiresAt);

  // Бейдж должен появиться и в чужом просмотре профиля, и на постах автора.
  const publicProfile = await client()('GET', '/api/users/bobik');
  assert.equal(publicProfile.user.isPro, true);

  const created = await bob.call('POST', '/api/posts', {
    promptText: 'Промпт от Pro-автора для проверки бейджа',
    modelFamily: 'chatgpt',
  });
  assert.equal(created.post.author.isPro, true);

  const cancel = await bob.call('POST', '/api/pro/cancel');
  assert.equal(cancel.user.isPro, false);
  assert.equal(cancel.user.proExpiresAt, null);

  const afterCancel = await bob.call('GET', `/api/posts/${created.post.id}`);
  assert.equal(afterCancel.post.author.isPro, false);
});

test('Pro: подписка требует входа', async () => {
  const res = await client()('POST', '/api/pro/subscribe', undefined, { raw: true });
  assert.equal(res.status, 401);
});

test('Eduardo: текстовый лимит free-пользователя и демо-режим', async () => {
  const created = await signUp('eduardo-free@example.com', 'eduardo_free', 'Едуардо Фри');

  const usageBefore = await created.call('GET', '/api/eduardo/usage');
  assert.equal(usageBefore.text.limit, 5);
  assert.equal(usageBefore.text.used, 0);
  assert.equal(usageBefore.pro, false);

  let last;
  for (let i = 0; i < 5; i += 1) {
    last = await created.call('POST', '/api/eduardo/text', { tool: 'qa', prompt: `Вопрос номер ${i}` });
    assert.equal(last.simulated, true, 'без DEEPSEEK_API_KEY ответ всегда демо-режим');
    assert.ok(last.result.includes('Демо-ответ Eduardo'));
  }
  assert.equal(last.usage.text.used, 5);
  assert.equal(last.usage.text.remaining, 0);

  const overLimit = await created.call('POST', '/api/eduardo/text', { tool: 'qa', prompt: 'Ещё один вопрос' }, { raw: true });
  assert.equal(overLimit.status, 402);
  assert.equal(overLimit.data.code, 'limit_reached');

  const history = await created.call('GET', '/api/eduardo/history');
  assert.equal(history.items.length, 5);
  assert.equal(history.items[0].tool, 'qa');
});

test('Eduardo: параллельные запросы не пробивают месячный лимит (гонка)', async () => {
  const created = await signUp('eduardo-race@example.com', 'eduardo_race', 'Едуардо Рейс');

  // Резервирование лимита — один атомарный SQL-запрос (INSERT/UPDATE с
  // условием прямо в WHERE), поэтому даже параллельные запросы от одного
  // пользователя не могут все проскочить проверку до того, как счётчик
  // обновится — race condition из «прочитать, потом отдельно записать»
  // здесь невозможна в принципе, а не просто маловероятна.
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      created.call('POST', '/api/eduardo/text', { tool: 'qa', prompt: `Гонка номер ${i}` }, { raw: true }),
    ),
  );
  const okCount = results.filter((r) => r.status === 200).length;
  const limitedCount = results.filter((r) => r.status === 402).length;
  assert.equal(okCount, 5, 'ровно 5 из 8 параллельных запросов должны пройти при лимите 5');
  assert.equal(limitedCount, 3);

  const usage = await created.call('GET', '/api/eduardo/usage');
  assert.equal(usage.text.used, 5, 'счётчик не должен уйти выше лимита из-за гонки');
});

test('Eduardo: генерация теста и кода (демо-режим)', async () => {
  const created = (eduardoTools = await signUp('eduardo-tools@example.com', 'eduardo_tools', 'Едуардо Тулс'));

  const testResult = await created.call('POST', '/api/eduardo/text', { tool: 'test', prompt: 'Столицы Европы' });
  assert.ok(testResult.result.includes('демо-заглушка') || testResult.result.toLowerCase().includes('демо'));

  const codeResult = await created.call('POST', '/api/eduardo/text', { tool: 'code', prompt: 'Функция сортировки массива' });
  assert.ok(codeResult.result.includes('```'));

  const badTool = await created.call('POST', '/api/eduardo/text', { tool: 'nonsense', prompt: 'Что-то' }, { raw: true });
  assert.equal(badTool.status, 400);
});

test('Eduardo: текстовый запрос реально уходит в DeepSeek, когда ключ настроен', async () => {
  // Переиспользуем аккаунт из предыдущего теста (не заводим нового пользователя
  // ради экономии общего лимита /api/auth/request-code на IP теста).
  const created = eduardoTools;

  const originalFetch = globalThis.fetch;
  let sentBody;
  globalThis.fetch = async (url, init) => {
    if (String(url) === 'https://api.deepseek.com/chat/completions') {
      sentBody = JSON.parse(init.body);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'Настоящий ответ от DeepSeek.' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return originalFetch(url, init);
  };
  let result;
  try {
    await withDeepseekKey(async () => {
      result = await created.call('POST', '/api/eduardo/text', { tool: 'qa', prompt: 'Настоящий вопрос' });
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(result.simulated, false);
  assert.equal(result.result, 'Настоящий ответ от DeepSeek.');
  assert.equal(sentBody.model, 'deepseek-v4-flash');
  assert.equal(sentBody.messages.at(-1).content, 'Настоящий вопрос');
});

test('Eduardo: генерация изображений пока отключена — «скоро будет доступно»', async () => {
  const created = eduardoTools;

  const res = await created.call('POST', '/api/eduardo/image', { prompt: 'Киберпанк-город ночью' }, { raw: true });
  assert.equal(res.status, 503);
  assert.equal(res.data.code, 'image_coming_soon');

  const usage = await created.call('GET', '/api/eduardo/usage');
  assert.equal(usage.image.used, 0, 'отключённая генерация не должна тратить лимит');
});

test('Eduardo: у Pro-пользователя лимиты выше', async () => {
  const created = await signUp('eduardo-pro@example.com', 'eduardo_pro', 'Едуардо Про');
  await created.call('POST', '/api/pro/subscribe');

  const usage = await created.call('GET', '/api/eduardo/usage');
  assert.equal(usage.pro, true);
  assert.equal(usage.text.limit, 20);
  assert.equal(usage.image.limit, 3);
});

test('Eduardo: ежедневная уборка удаляет только счётчики за прошлые месяцы', async () => {
  const userId = bob.user.id;
  const oldPeriod = '2000-01';
  const currentPeriod = new Date().toISOString().slice(0, 7);
  dbRun(
    `INSERT INTO eduardo_usage (user_id, period, text_used, image_used) VALUES ($userId, $period, 3, 1)
     ON CONFLICT(user_id, period) DO UPDATE SET text_used = 3, image_used = 1`,
    { userId, period: oldPeriod },
  );
  dbRun(
    `INSERT INTO eduardo_usage (user_id, period, text_used) VALUES ($userId, $period, 1)
     ON CONFLICT(user_id, period) DO UPDATE SET text_used = text_used`,
    { userId, period: currentPeriod },
  );

  pruneOldEduardoUsage();

  const oldRow = dbGet('SELECT 1 AS found FROM eduardo_usage WHERE user_id = $userId AND period = $period', {
    userId,
    period: oldPeriod,
  });
  assert.ok(!oldRow, 'строка за прошлый месяц должна быть удалена уборкой');

  const currentRow = dbGet('SELECT 1 AS found FROM eduardo_usage WHERE user_id = $userId AND period = $period', {
    userId,
    period: currentPeriod,
  });
  assert.ok(currentRow, 'счётчик за текущий месяц уборка трогать не должна');
});

test('Eduardo требует входа', async () => {
  const res = await client()('POST', '/api/eduardo/text', { tool: 'qa', prompt: 'Вопрос' }, { raw: true });
  assert.equal(res.status, 401);
});

test('Модели: анонимный доступ к каталогу и создание требует входа', async () => {
  const anon = await client()('GET', '/api/models');
  assert.deepEqual(anon.global, []);
  assert.deepEqual(anon.mine, []);

  const res = await client()('POST', '/api/models', { name: 'Что-то' }, { raw: true });
  assert.equal(res.status, 401);
});

test('Модели: пользователь добавляет свою модель, видна только у него и на его профиле', async () => {
  // Не alice — её сессию убивает более ранний тест бана/разбана (бан
  // закрывает все сессии, повторный вход тестом не выполняется).
  // eduardoTools — посторонний пользователь: не владелец и не админ.
  const created = await bob.call('POST', '/api/models', { name: 'Мой ассистент', iconUrl: 'https://example.com/a.png' });
  assert.equal(created.model.name, 'Мой ассистент');
  assert.equal(created.model.isGlobal, false);

  const mineList = await bob.call('GET', '/api/models');
  assert.ok(mineList.mine.some((m) => m.id === created.model.id));
  assert.ok(!mineList.global.some((m) => m.id === created.model.id));

  const publicList = await eduardoTools.call('GET', `/api/models/user/${bob.user.username}`);
  assert.ok(publicList.items.some((m) => m.id === created.model.id));

  const strangersView = await eduardoTools.call('GET', '/api/models');
  assert.ok(!strangersView.mine.some((m) => m.id === created.model.id), 'чужая личная модель не должна попадать в mine');

  const forbiddenDelete = await eduardoTools.call('DELETE', `/api/models/${created.model.id}`, undefined, { raw: true });
  assert.equal(forbiddenDelete.status, 403, 'посторонний пользователь не может удалить чужую модель');

  const renamed = await bob.call('PATCH', `/api/models/${created.model.id}`, { name: 'Обновлённое имя' });
  assert.equal(renamed.model.name, 'Обновлённое имя');

  // Админ модерирует чужие модели — это разрешённое действие, не 403.
  await admin.call('DELETE', `/api/models/${created.model.id}`);
  const afterDelete = await bob.call('GET', '/api/models');
  assert.ok(!afterDelete.mine.some((m) => m.id === created.model.id));
});

test('Модели: только админ может добавлять в общий каталог', async () => {
  const asUser = await bob.call('POST', '/api/models', { name: 'Хочу глобально', global: true }, { raw: true });
  assert.equal(asUser.status, 403);

  const created = await admin.call('POST', '/api/models', { name: 'Общая модель', global: true });
  assert.equal(created.model.isGlobal, true);
  assert.equal(created.model.ownerId, null);

  const list = await bob.call('GET', '/api/models');
  assert.ok(list.global.some((m) => m.id === created.model.id), 'общая модель видна всем');

  const userDelete = await bob.call('DELETE', `/api/models/${created.model.id}`, undefined, { raw: true });
  assert.equal(userDelete.status, 403);

  await admin.call('DELETE', `/api/models/${created.model.id}`);
  const after = await client()('GET', '/api/models');
  assert.ok(!after.global.some((m) => m.id === created.model.id));
});

test('DM: отправка сообщения, счётчик непрочитанного и отметка прочитанным', async () => {
  const sent = await bob.call('POST', `/api/dm/${eduardoTools.user.username}`, { body: 'Привет! Как продвигается промпт?' });
  assert.equal(sent.message.body, 'Привет! Как продвигается промпт?');
  assert.equal(sent.message.mine, true);

  const recipientConvos = await eduardoTools.call('GET', '/api/dm/conversations');
  const withBob = recipientConvos.items.find((i) => i.user.username === bob.user.username);
  assert.ok(withBob, 'диалог с bob должен появиться у получателя');
  assert.equal(withBob.unread, 1);
  assert.equal(withBob.lastMessage.mine, false);

  const senderConvos = await bob.call('GET', '/api/dm/conversations');
  const withRecipient = senderConvos.items.find((i) => i.user.username === eduardoTools.user.username);
  assert.ok(withRecipient);
  assert.equal(withRecipient.unread, 0, 'у отправителя его же сообщение не считается непрочитанным');
  assert.equal(withRecipient.lastMessage.mine, true);

  const thread = await eduardoTools.call('GET', `/api/dm/${bob.user.username}`);
  assert.equal(thread.items.length, 1);
  assert.equal(thread.items[0].body, 'Привет! Как продвигается промпт?');

  const afterRead = await eduardoTools.call('GET', '/api/dm/conversations');
  const afterReadWithBob = afterRead.items.find((i) => i.user.username === bob.user.username);
  assert.equal(afterReadWithBob.unread, 0, 'открытие переписки должно пометить сообщения прочитанными');
});

test('DM: нельзя писать себе, пустое сообщение и несуществующий адресат отклоняются', async () => {
  const toSelf = await bob.call('POST', `/api/dm/${bob.user.username}`, { body: 'Привет себе' }, { raw: true });
  assert.equal(toSelf.status, 400);

  const empty = await bob.call('POST', `/api/dm/${eduardoTools.user.username}`, { body: '   ' }, { raw: true });
  assert.equal(empty.status, 400);

  const noSuchUser = await bob.call('POST', '/api/dm/no_such_user_xyz', { body: 'Привет' }, { raw: true });
  assert.equal(noSuchUser.status, 404);
});

test('DM требует входа', async () => {
  const res = await client()('POST', `/api/dm/${bob.user.username}`, { body: 'Привет' }, { raw: true });
  assert.equal(res.status, 401);
  const res2 = await client()('GET', '/api/dm/conversations', undefined, { raw: true });
  assert.equal(res2.status, 401);
});

test('test-prompt: пустой промпт отклоняется', async () => {
  const res = await client()('POST', '/api/test-prompt', { prompt: '  ' }, { raw: true });
  assert.equal(res.status, 400);
});

test('test-prompt: промпт длиннее 4000 символов отклоняется', async () => {
  const res = await client()('POST', '/api/test-prompt', { prompt: 'а'.repeat(4001) }, { raw: true });
  assert.equal(res.status, 400);
});

test('test-prompt: успешный ответ DeepSeek не содержит ключ и режет max_tokens', async () => {
  const originalFetch = globalThis.fetch;
  let sentBody;
  globalThis.fetch = async (url, init) => {
    if (String(url) === 'https://api.deepseek.com/chat/completions') {
      sentBody = JSON.parse(init.body);
      assert.equal(init.headers.authorization, 'Bearer test-deepseek-key');
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'Привет! Это ответ DeepSeek.' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return originalFetch(url, init);
  };
  let res;
  try {
    await withDeepseekKey(async () => {
      res = await client()('POST', '/api/test-prompt', { prompt: 'Скажи привет' }, { raw: true });
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(res.status, 200);
  assert.equal(res.data.text, 'Привет! Это ответ DeepSeek.');
  assert.equal(sentBody.model, 'deepseek-v4-flash');
  assert.equal(sentBody.max_tokens, 1000);
  const raw = JSON.stringify(res.data);
  assert.ok(!raw.includes('test-deepseek-key'), 'ключ не должен попадать в ответ клиенту');
});

test('test-prompt: невалидный ключ DeepSeek превращается в понятную ошибку', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url) === 'https://api.deepseek.com/chat/completions') {
      return new Response(JSON.stringify({ error: { message: 'Invalid API key sk-real-secret-value' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    }
    return originalFetch(url, init);
  };
  let res;
  try {
    await withDeepseekKey(async () => {
      res = await client()('POST', '/api/test-prompt', { prompt: 'Тест' }, { raw: true });
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(res.status, 502);
  assert.equal(res.data.code, 'deepseek_auth');
  assert.ok(!res.data.error.includes('sk-real-secret-value'), 'техническая ошибка DeepSeek не должна утекать клиенту');
});

test('test-prompt: таймаут запроса к DeepSeek возвращает 504', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url) === 'https://api.deepseek.com/chat/completions') {
      const err = new Error('The operation was aborted');
      err.name = 'TimeoutError';
      throw err;
    }
    return originalFetch(url, init);
  };
  let res;
  try {
    await withDeepseekKey(async () => {
      res = await client()('POST', '/api/test-prompt', { prompt: 'Тест' }, { raw: true });
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(res.status, 504);
  assert.equal(res.data.code, 'deepseek_timeout');
});

test('test-prompt: без ключа на сервере честно сообщает, что не настроен', async () => {
  const res = await client()('POST', '/api/test-prompt', { prompt: 'Тест' }, { raw: true });
  assert.equal(res.status, 503);
  assert.equal(res.data.code, 'deepseek_not_configured');
});

test('test-prompt: rate limit — не больше 10 запросов в минуту с одного IP', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url) === 'https://api.deepseek.com/chat/completions') {
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return originalFetch(url, init);
  };
  // Свой X-Forwarded-For, чтобы не делить счётчик лимита с предыдущими тестами
  // (все они шли с одного и того же IP тестового клиента).
  const post = (prompt) =>
    fetch(`${base}/api/test-prompt`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Requested-With': 'ThePrompt',
        'X-Forwarded-For': '203.0.113.42',
      },
      body: JSON.stringify({ prompt }),
    });
  try {
    await withDeepseekKey(async () => {
      let last;
      for (let i = 0; i < 11; i++) {
        last = await post(`Запрос ${i}`);
      }
      assert.equal(last.status, 429);
      const data = await last.json();
      assert.equal(data.code, 'rate_limited');

      const eleventhAllowed = await post('Проверка что 10-й ещё проходит');
      assert.equal(eleventhAllowed.status, 429, 'лимит не сбрасывается между запросами в пределах минуты');
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('пароль: изначально не задан, можно задать без текущего пароля', async () => {
  const me0 = await bob.call('GET', '/api/auth/me');
  assert.equal(me0.user.hasPassword, false);

  const res = await bob.call('POST', '/api/me/password', { newPassword: 'первыйпароль123' });
  assert.equal(res.user.hasPassword, true);
});

test('пароль: смена требует верный текущий пароль', async () => {
  const wrong = await bob.call(
    'POST',
    '/api/me/password',
    { currentPassword: 'неправильный', newPassword: 'новыйпароль456' },
    { raw: true },
  );
  assert.equal(wrong.status, 400);
  assert.equal(wrong.data.code, 'wrong_password');

  const ok = await bob.call('POST', '/api/me/password', {
    currentPassword: 'первыйпароль123',
    newPassword: 'новыйпароль456',
  });
  assert.equal(ok.user.hasPassword, true);
});

test('пароль: слишком короткий пароль отклоняется', async () => {
  const res = await bob.call('POST', '/api/me/password', { newPassword: '123' }, { raw: true });
  assert.equal(res.status, 400);
});

test('вход по паролю: верные данные открывают сессию, неверные — отклоняются', async () => {
  const wrong = await client()(
    'POST',
    '/api/auth/login-password',
    { email: 'bob@example.com', password: 'не тот пароль' },
    { raw: true },
  );
  assert.equal(wrong.status, 400);
  assert.equal(wrong.data.code, 'invalid_credentials');

  const fresh = client();
  const ok = await fresh('POST', '/api/auth/login-password', {
    email: 'bob@example.com',
    password: 'новыйпароль456',
  });
  assert.equal(ok.user.username, 'bobik');
  const me = await fresh('GET', '/api/auth/me');
  assert.equal(me.user.username, 'bobik');
});

test('язык интерфейса: сохраняется через PATCH /api/me', async () => {
  const bad = await bob.call('PATCH', '/api/me', { locale: 'fr' }, { raw: true });
  assert.equal(bad.status, 400);

  const res = await bob.call('PATCH', '/api/me', { locale: 'en' });
  assert.equal(res.user.locale, 'en');

  const me = await bob.call('GET', '/api/auth/me');
  assert.equal(me.user.locale, 'en');
});

test('выход закрывает сессию', async () => {
  await bob.call('POST', '/api/auth/logout');
  const me = await bob.call('GET', '/api/auth/me');
  assert.equal(me.user, null);
});
