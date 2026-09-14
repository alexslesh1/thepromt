/**
 * Личные сообщения (Direct Messages) между пользователями — не путать с
 * разделом «Сообщения» (это внутренние уведомления платформы, routes/notifications.js).
 * Новое сообщение уходит получателю мгновенно через WebSocket, если он на сайте.
 */
import express from 'express';
import { all, get, run } from '../db.js';
import { requireAuth } from '../auth.js';
import { publicUser, userByUsername } from '../store.js';
import { badRequest, createRateLimiter, notFound, nowIso, text, wrap } from '../util.js';
import { pushToUser } from '../ws.js';

export const router = express.Router();

const MAX_BODY = 2000;
const sendLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 30 });

function shapeMessage(row, viewerId) {
  return {
    id: row.id,
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    body: row.body,
    mine: row.sender_id === viewerId,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

/** GET /api/dm/conversations — список диалогов по убыванию последнего сообщения. */
router.get(
  '/conversations',
  requireAuth,
  wrap(async (req, res) => {
    const partners = all(
      `SELECT other_id, MAX(created_at) AS last_at FROM (
         SELECT recipient_id AS other_id, created_at FROM dm_messages WHERE sender_id = $userId
         UNION ALL
         SELECT sender_id AS other_id, created_at FROM dm_messages WHERE recipient_id = $userId
       ) GROUP BY other_id ORDER BY last_at DESC`,
      { userId: req.user.id },
    );

    const items = partners.map(({ other_id: otherId }) => {
      const other = get('SELECT * FROM users WHERE id = $id', { id: otherId });
      const last = get(
        `SELECT * FROM dm_messages
         WHERE (sender_id = $me AND recipient_id = $other) OR (sender_id = $other AND recipient_id = $me)
         ORDER BY created_at DESC, id DESC LIMIT 1`,
        { me: req.user.id, other: otherId },
      );
      const unread = get(
        `SELECT COUNT(*) AS n FROM dm_messages
         WHERE sender_id = $other AND recipient_id = $me AND read_at IS NULL`,
        { me: req.user.id, other: otherId },
      ).n;
      return {
        user: publicUser(other, req.user.id),
        lastMessage: last ? shapeMessage(last, req.user.id) : null,
        unread,
      };
    });

    res.json({ items });
  }),
);

/** GET /api/dm/:username — история переписки; открытие помечает входящие прочитанными. */
router.get(
  '/:username',
  requireAuth,
  wrap(async (req, res) => {
    const other = userByUsername(req.params.username);
    if (!other) throw notFound('Пользователь не найден');
    if (other.id === req.user.id) throw badRequest('Нельзя написать самому себе');

    run(
      `UPDATE dm_messages SET read_at = $now
       WHERE sender_id = $other AND recipient_id = $me AND read_at IS NULL`,
      { me: req.user.id, other: other.id, now: nowIso() },
    );

    const rows = all(
      `SELECT * FROM dm_messages
       WHERE (sender_id = $me AND recipient_id = $other) OR (sender_id = $other AND recipient_id = $me)
       ORDER BY created_at ASC, id ASC LIMIT 200`,
      { me: req.user.id, other: other.id },
    );
    res.json({
      user: publicUser(other, req.user.id),
      items: rows.map((row) => shapeMessage(row, req.user.id)),
    });
  }),
);

/** POST /api/dm/:username — отправить сообщение. */
router.post(
  '/:username',
  requireAuth,
  wrap(async (req, res) => {
    const check = sendLimiter(`dm:${req.user.id}`);
    if (!check.ok) {
      res.set('Retry-After', String(check.retryAfter));
      throw badRequest(`Слишком много сообщений. Попробуйте через ${check.retryAfter} сек.`, 'rate_limited');
    }
    const other = userByUsername(req.params.username);
    if (!other) throw notFound('Пользователь не найден');
    if (other.id === req.user.id) throw badRequest('Нельзя написать самому себе');
    const body = text(req.body?.body, { max: MAX_BODY, min: 1, field: 'Сообщение', required: true });

    const result = run(
      'INSERT INTO dm_messages (sender_id, recipient_id, body) VALUES ($senderId, $recipientId, $body)',
      { senderId: req.user.id, recipientId: other.id, body },
    );
    const row = get('SELECT * FROM dm_messages WHERE id = $id', { id: result.lastInsertRowid });
    const message = shapeMessage(row, req.user.id);

    pushToUser(other.id, {
      type: 'dm:new',
      message: { ...message, mine: false },
      from: publicUser(req.user, other.id),
    });

    res.status(201).json({ message });
  }),
);
