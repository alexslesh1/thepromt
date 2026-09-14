/**
 * Подписка ThePrompt Pro.
 *
 * В этой сборке платёжный процессинг не подключён (нет ключей Stripe/etc.) —
 * подписка активируется мгновенно по кнопке, честно помечена в интерфейсе
 * как демо-режим. Хватает, чтобы показать весь остальной продукт: бейдж
 * верификации, лимиты Eduardo, тарифную модалку. Подключить реальную оплату
 * можно, не трогая остальной код — только эти два обработчика.
 */
import express from 'express';
import { config } from '../config.js';
import { run } from '../db.js';
import { requireAuth } from '../auth.js';
import { privateUser, userById } from '../store.js';
import { isoPlus, nowIso, wrap } from '../util.js';

export const router = express.Router();

/** POST /api/pro/subscribe — демо-активация на config.pro.durationDays дней. */
router.post(
  '/subscribe',
  requireAuth,
  wrap(async (req, res) => {
    run(
      `UPDATE users SET is_pro = 1, pro_since = $now, pro_expires_at = $expires WHERE id = $id`,
      { id: req.user.id, now: nowIso(), expires: isoPlus(config.pro.durationDays * 24 * 60 * 60 * 1000) },
    );
    res.json({ user: privateUser(userById(req.user.id)) });
  }),
);

/** POST /api/pro/cancel — немедленно отключает Pro (демо-режим без возвратов). */
router.post(
  '/cancel',
  requireAuth,
  wrap(async (req, res) => {
    run(`UPDATE users SET is_pro = 0, pro_expires_at = NULL WHERE id = $id`, { id: req.user.id });
    res.json({ user: privateUser(userById(req.user.id)) });
  }),
);
