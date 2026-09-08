import express from 'express';
import { config } from '../config.js';
import { get, run } from '../db.js';
import { requireAuth } from '../auth.js';
import { countUnreadNotifications, listNotifications } from '../store.js';
import { clampInt, notFound, nowIso, wrap } from '../util.js';

export const router = express.Router();

/** GET /api/notifications — внутренние сообщения пользователя. */
router.get(
  '/',
  requireAuth,
  wrap(async (req, res) => {
    const limit = clampInt(req.query.limit, { min: 1, max: 50, fallback: config.feed.pageSize });
    const page = clampInt(req.query.page, { min: 1, max: 1000, fallback: 1 });
    const items = listNotifications(req.user.id, { limit: limit + 1, offset: (page - 1) * limit });
    const hasMore = items.length > limit;
    res.json({
      items: items.slice(0, limit),
      unread: countUnreadNotifications(req.user.id),
      page,
      hasMore,
    });
  }),
);

/** POST /api/notifications/read — отметить всё или одно уведомление прочитанным. */
router.post(
  '/read',
  requireAuth,
  wrap(async (req, res) => {
    if (req.body?.id) {
      const row = get('SELECT * FROM notifications WHERE id = $id AND user_id = $u', {
        id: Number(req.body.id),
        u: req.user.id,
      });
      if (!row) throw notFound('Уведомление не найдено');
      run('UPDATE notifications SET read_at = $now WHERE id = $id', { id: row.id, now: nowIso() });
    } else {
      run('UPDATE notifications SET read_at = $now WHERE user_id = $u AND read_at IS NULL', {
        u: req.user.id,
        now: nowIso(),
      });
    }
    res.json({ ok: true, unread: countUnreadNotifications(req.user.id) });
  }),
);
