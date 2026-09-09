import express from 'express';
import { config } from '../config.js';
import { all, get, run } from '../db.js';
import { requireAuth } from '../auth.js';
import {
  bookmarkedPostRows,
  buildFeedItems,
  likedPostRows,
  notify,
  privateUser,
  profileFeedRows,
  publicUser,
  searchUsers,
  userById,
  userByUsername,
} from '../store.js';
import { LIMITS } from '../constants.js';
import {
  badRequest,
  clampInt,
  forbidden,
  normalizeUsername,
  notFound,
  nowIso,
  text,
  wrap,
} from '../util.js';

export const router = express.Router();

function pagination(req) {
  const limit = clampInt(req.query.limit, { min: 1, max: 50, fallback: config.feed.pageSize });
  const page = clampInt(req.query.page, { min: 1, max: 10000, fallback: 1 });
  return { limit, offset: (page - 1) * limit, page };
}

/** GET /api/users/:username — профиль пользователя. */
router.get(
  '/:username',
  wrap(async (req, res) => {
    const row = userByUsername(req.params.username);
    if (!row || !row.username) throw notFound('Пользователь не найден');
    res.json({ user: publicUser(row, req.user?.id ?? null) });
  }),
);

/** GET /api/users/:username/posts?tab=posts|likes — лента профиля. */
router.get(
  '/:username/posts',
  wrap(async (req, res) => {
    const row = userByUsername(req.params.username);
    if (!row || !row.username) throw notFound('Пользователь не найден');
    const { limit, offset, page } = pagination(req);
    const viewerId = req.user?.id ?? 0;
    const requested = String(req.query.tab ?? 'posts');
    const tab = ['posts', 'likes', 'bookmarks'].includes(requested) ? requested : 'posts';

    // Сохранённое — приватная вкладка: её видит только владелец профиля.
    if (tab === 'bookmarks' && req.user?.id !== row.id) {
      throw forbidden('Сохранённые промпты видны только владельцу профиля');
    }

    const loaders = {
      posts: profileFeedRows,
      likes: likedPostRows,
      bookmarks: bookmarkedPostRows,
    };
    const rows = loaders[tab](row.id, { limit: limit + 1, offset });

    const hasMore = rows.length > limit;
    res.json({ items: buildFeedItems(rows.slice(0, limit), viewerId), page, limit, hasMore, tab });
  }),
);

/** GET /api/users/:username/followers | /following */
for (const kind of ['followers', 'following']) {
  router.get(
    `/:username/${kind}`,
    wrap(async (req, res) => {
      const row = userByUsername(req.params.username);
      if (!row || !row.username) throw notFound('Пользователь не найден');
      const { limit, offset } = pagination(req);
      const sql =
        kind === 'followers'
          ? `SELECT u.* FROM follows f JOIN users u ON u.id = f.follower_id
             WHERE f.followee_id = $id ORDER BY f.created_at DESC LIMIT $limit OFFSET $offset`
          : `SELECT u.* FROM follows f JOIN users u ON u.id = f.followee_id
             WHERE f.follower_id = $id ORDER BY f.created_at DESC LIMIT $limit OFFSET $offset`;
      const users = all(sql, { id: row.id, limit, offset }).map((u) =>
        publicUser(u, req.user?.id ?? null),
      );
      res.json({ users });
    }),
  );
}

/** POST /api/users/:username/follow — подписаться/отписаться. */
router.post(
  '/:username/follow',
  requireAuth,
  wrap(async (req, res) => {
    const row = userByUsername(req.params.username);
    if (!row || !row.username) throw notFound('Пользователь не найден');
    if (row.id === req.user.id) throw badRequest('Нельзя подписаться на себя');

    const existing = get('SELECT 1 AS x FROM follows WHERE follower_id = $f AND followee_id = $t', {
      f: req.user.id,
      t: row.id,
    });
    if (existing) {
      run('DELETE FROM follows WHERE follower_id = $f AND followee_id = $t', {
        f: req.user.id,
        t: row.id,
      });
    } else {
      run('INSERT INTO follows (follower_id, followee_id) VALUES ($f, $t)', {
        f: req.user.id,
        t: row.id,
      });
      notify({
        userId: row.id,
        actorId: req.user.id,
        type: 'follow',
        title: `@${req.user.username} подписался(ась) на вас`,
        link: `/u/${req.user.username}`,
      });
    }
    res.json({ user: publicUser(userById(row.id), req.user.id) });
  }),
);

/* --------------------------- Настройки ---------------------------- */

export const meRouter = express.Router();

/** PATCH /api/me — обновление профиля и настроек. */
meRouter.patch(
  '/',
  requireAuth,
  wrap(async (req, res) => {
    const body = req.body ?? {};
    const updates = {};

    if (body.displayName !== undefined) {
      updates.display_name =
        text(body.displayName, { max: LIMITS.displayName, field: 'Отображаемое имя' }) ||
        req.user.username;
    }
    if (body.bio !== undefined) {
      updates.bio = text(body.bio, { max: LIMITS.bio, field: 'О себе' });
    }
    if (body.theme !== undefined) {
      if (!['light', 'dark'].includes(body.theme)) throw badRequest('Неизвестная тема');
      updates.theme = body.theme;
    }
    if (body.avatarUrl !== undefined) {
      updates.avatar_url = body.avatarUrl ? String(body.avatarUrl).slice(0, 300) : null;
    }
    if (body.bannerUrl !== undefined) {
      updates.banner_url = body.bannerUrl ? String(body.bannerUrl).slice(0, 300) : null;
    }
    if (body.username !== undefined) {
      const username = normalizeUsername(body.username);
      if (username !== req.user.username) {
        if (userByUsername(username)) throw badRequest('Никнейм уже занят', 'username_taken');
        updates.username = username;
      }
    }

    if (!Object.keys(updates).length) throw badRequest('Нечего обновлять');

    const setSql = Object.keys(updates)
      .map((key) => `${key} = $${key}`)
      .join(', ');
    run(`UPDATE users SET ${setSql}, updated_at = $updated_at WHERE id = $id`, {
      ...updates,
      updated_at: nowIso(),
      id: req.user.id,
    });

    res.json({ user: privateUser(userById(req.user.id)) });
  }),
);

/** DELETE /api/me — удаление аккаунта вместе с постами. */
meRouter.delete(
  '/',
  requireAuth,
  wrap(async (req, res) => {
    if (req.user.role === 'admin') throw forbidden('Аккаунт администратора нельзя удалить из интерфейса');
    run('DELETE FROM users WHERE id = $id', { id: req.user.id });
    res.json({ ok: true });
  }),
);

/** GET /api/search?q=… — поиск по промптам и людям. */
export const searchRouter = express.Router();

searchRouter.get(
  '/users',
  wrap(async (req, res) => {
    const q = String(req.query.q ?? '').trim().slice(0, 60);
    if (!q) return res.json({ users: [] });
    res.json({ users: searchUsers(q, req.user?.id ?? null) });
  }),
);
