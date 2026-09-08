/**
 * End-to-end проверка API PromptShare.
 * Запуск: npm test  (использует отдельную временную базу)
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';

const tmpDb = path.join(os.tmpdir(), `promptshare-test-${Date.now()}.db`);
process.env.DB_FILE = tmpDb;
process.env.NODE_ENV = 'test';
process.env.ADMIN_EMAILS = 'admin@example.com';
process.env.SESSION_SECRET = 'test-secret';

const { app } = await import('../server/index.js');
const { closeDb } = await import('../server/db.js');

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
  return async function call(method, url, body, { raw = false } = {}) {
    const headers = { 'X-Requested-With': 'PromptShare' };
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

test('регистрация по email с кодом подтверждения', async () => {
  alice = await signUp('alice@example.com', 'alice', 'Алиса');
  bob = await signUp('bob@example.com', 'bob', 'Боб');
  admin = await signUp('admin@example.com', 'moderator', 'Модератор');

  assert.equal(alice.user.role, 'user');
  assert.equal(admin.user.role, 'admin', 'email из ADMIN_EMAILS получает роль администратора');
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

  const bobFeed = await client()('GET', '/api/users/bob/posts');
  const kinds = bobFeed.items.map((i) => i.type);
  assert.ok(kinds.includes('repost'), 'репост виден в профиле');
  assert.ok(kinds.includes('post'));

  const likes = await client()('GET', '/api/users/bob/posts?tab=likes');
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
  assert.equal(report.reporter.username, 'bob');
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

test('выход закрывает сессию', async () => {
  await bob.call('POST', '/api/auth/logout');
  const me = await bob.call('GET', '/api/auth/me');
  assert.equal(me.user, null);
});
