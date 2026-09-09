/**
 * Пользовательские и общие AI-модели (сущность Model).
 *
 * owner_id = NULL — модель в общем каталоге, её видят все и меняют только
 * администраторы. owner_id = id пользователя — личная модель в его профиле,
 * которую он сам добавил, редактирует и удаляет (админ может модерировать
 * чужую тоже).
 */
import express from 'express';
import { all, get, run } from '../db.js';
import { requireAuth } from '../auth.js';
import { LIMITS } from '../constants.js';
import { badRequest, forbidden, notFound, text, wrap } from '../util.js';

export const router = express.Router();

function shapeModel(row) {
  return {
    id: row.id,
    name: row.name,
    iconUrl: row.icon_url,
    ownerId: row.owner_id,
    isGlobal: row.owner_id === null,
    createdAt: row.created_at,
  };
}

function readIconUrl(value) {
  if (value === undefined) return undefined;
  return value ? String(value).slice(0, 300) : null;
}

/** GET /api/models — общий каталог + (если вошли) свои личные модели. */
router.get(
  '/',
  wrap(async (req, res) => {
    const global = all('SELECT * FROM models WHERE owner_id IS NULL ORDER BY name');
    const mine = req.user
      ? all('SELECT * FROM models WHERE owner_id = $userId ORDER BY created_at DESC', { userId: req.user.id })
      : [];
    res.json({ global: global.map(shapeModel), mine: mine.map(shapeModel) });
  }),
);

/** GET /api/models/user/:username — личные модели конкретного пользователя (для профиля). */
router.get(
  '/user/:username',
  wrap(async (req, res) => {
    const owner = get('SELECT id FROM users WHERE username = $username', { username: req.params.username });
    if (!owner) throw notFound('Пользователь не найден');
    const rows = all('SELECT * FROM models WHERE owner_id = $userId ORDER BY created_at DESC', {
      userId: owner.id,
    });
    res.json({ items: rows.map(shapeModel) });
  }),
);

/** POST /api/models — добавить модель. Админ может сделать её общей (global: true). */
router.post(
  '/',
  requireAuth,
  wrap(async (req, res) => {
    const name = text(req.body?.name, { max: LIMITS.modelName, min: 2, field: 'Название', required: true });
    const iconUrl = readIconUrl(req.body?.iconUrl) ?? null;
    const wantsGlobal = !!req.body?.global;
    if (wantsGlobal && req.user.role !== 'admin') {
      throw forbidden('Добавлять модели в общий каталог может только администратор');
    }

    if (!wantsGlobal) {
      const { count } = get('SELECT COUNT(*) AS count FROM models WHERE owner_id = $userId', {
        userId: req.user.id,
      });
      if (count >= LIMITS.ownModelsPerUser) {
        throw badRequest(`Можно добавить не больше ${LIMITS.ownModelsPerUser} своих моделей`);
      }
    }

    const result = run('INSERT INTO models (name, icon_url, owner_id) VALUES ($name, $iconUrl, $ownerId)', {
      name,
      iconUrl,
      ownerId: wantsGlobal ? null : req.user.id,
    });
    const row = get('SELECT * FROM models WHERE id = $id', { id: result.lastInsertRowid });
    res.status(201).json({ model: shapeModel(row) });
  }),
);

/** PATCH /api/models/:id — переименовать/сменить иконку своей модели (или любой — админу). */
router.patch(
  '/:id',
  requireAuth,
  wrap(async (req, res) => {
    const row = get('SELECT * FROM models WHERE id = $id', { id: req.params.id });
    if (!row) throw notFound('Модель не найдена');
    if (row.owner_id !== req.user.id && req.user.role !== 'admin') {
      throw forbidden('Это не ваша модель');
    }

    const updates = {};
    if (req.body?.name !== undefined) {
      updates.name = text(req.body.name, { max: LIMITS.modelName, min: 2, field: 'Название', required: true });
    }
    if (req.body?.iconUrl !== undefined) {
      updates.icon_url = readIconUrl(req.body.iconUrl);
    }
    if (!Object.keys(updates).length) throw badRequest('Нечего обновлять');

    const setSql = Object.keys(updates)
      .map((key) => `${key} = $${key}`)
      .join(', ');
    run(`UPDATE models SET ${setSql} WHERE id = $id`, { ...updates, id: row.id });
    const updated = get('SELECT * FROM models WHERE id = $id', { id: row.id });
    res.json({ model: shapeModel(updated) });
  }),
);

/** DELETE /api/models/:id — удалить свою модель (или любую — админу). */
router.delete(
  '/:id',
  requireAuth,
  wrap(async (req, res) => {
    const row = get('SELECT * FROM models WHERE id = $id', { id: req.params.id });
    if (!row) throw notFound('Модель не найдена');
    if (row.owner_id !== req.user.id && req.user.role !== 'admin') {
      throw forbidden('Это не ваша модель');
    }
    run('DELETE FROM models WHERE id = $id', { id: row.id });
    res.status(204).end();
  }),
);

