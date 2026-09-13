/**
 * Раздел Eduardo — чат с ИИ-помощником и генерация изображений.
 * Текстовые сообщения ограничены двумя окнами сразу (дневная сессия 24ч +
 * неделя со сбросом по понедельникам в 00:00 МСК); изображения — отдельным
 * помесячным лимитом (фича пока отключена). Оба зависят от Pro.
 */
import express from 'express';
import { config } from '../config.js';
import { all, get, run } from '../db.js';
import { requireAuth } from '../auth.js';
import { generateChatReply, generateImage } from '../eduardo.js';
import { isProActive } from '../store.js';
import { HttpError, createRateLimiter, limitReached, text, wrap } from '../util.js';

export const router = express.Router();

// Сколько последних сообщений отправляем модели как контекст диалога —
// достаточно для связного чата и не разгоняет счёт по токенам бесконечно.
const CONTEXT_MESSAGES = 20;

// Дневная и недельная квоты — это лимит расходов, а этот лимитер — защита
// от того, чтобы один пользователь не заваливал сервер и внешний AI API
// запросами пачками (даже в пределах своей квоты). Порог выше дневного
// лимита free-аккаунта (20), чтобы не мешать легитимному всплеску сообщений.
const burstLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 30 });

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000; // МСК = UTC+3 круглый год, без перехода на летнее время

const currentPeriod = () => new Date().toISOString().slice(0, 7); // 'YYYY-MM' — для месячного лимита изображений
const toDbTimestamp = (date) => date.toISOString().replace('T', ' ').slice(0, 19);
/** Сервер хранит время как 'YYYY-MM-DD HH:MM:SS' в UTC (см. server/util.js nowIso). */
const parseDbTimestamp = (value) => new Date(`${value.replace(' ', 'T')}Z`);

/** Начало текущей недели — ближайший (в прошлом) понедельник 00:00 по московскому времени, в UTC. */
function currentWeekStart() {
  const now = new Date();
  const shifted = new Date(now.getTime() + MSK_OFFSET_MS); // «МСК-время», выраженное UTC-полями
  const daysSinceMonday = (shifted.getUTCDay() + 6) % 7; // getUTCDay(): 0=вс..6=сб → понедельник=0
  const mondayShifted = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - daysSinceMonday * DAY_MS;
  return new Date(mondayShifted - MSK_OFFSET_MS);
}

function limitsFor(user) {
  const pro = isProActive(user);
  return {
    pro,
    dailyLimit: pro ? config.eduardo.proDailyLimit : config.eduardo.freeDailyLimit,
    weekLimit: pro ? config.eduardo.proWeekLimit : config.eduardo.freeWeekLimit,
    imageLimit: pro ? config.eduardo.proImageLimit : config.eduardo.freeImageLimit,
  };
}

function usageRow(userId, period) {
  return (
    get('SELECT * FROM eduardo_usage WHERE user_id = $userId AND period = $period', { userId, period }) ?? {
      text_used: 0,
      image_used: 0,
    }
  );
}

function limitsRow(userId) {
  run('INSERT OR IGNORE INTO eduardo_limits (user_id) VALUES ($userId)', { userId });
  return get('SELECT * FROM eduardo_limits WHERE user_id = $userId', { userId });
}

/** Тот же атомарный приём для помесячного лимита изображений (генерация изображений отключена, но задел остаётся). */
function tryReserveImageUsage(userId, period, limit) {
  const result = run(
    `INSERT INTO eduardo_usage (user_id, period, image_used) VALUES ($userId, $period, 1)
     ON CONFLICT(user_id, period) DO UPDATE SET image_used = image_used + 1 WHERE image_used < $limit`,
    { userId, period, limit },
  );
  return result.changes > 0;
}

function releaseImageUsage(userId, period) {
  run('UPDATE eduardo_usage SET image_used = MAX(0, image_used - 1) WHERE user_id = $userId AND period = $period', {
    userId,
    period,
  });
}

/**
 * Атомарно резервирует слот дневной сессии: если она устарела (>24ч с
 * daily_started_at) или ещё не начиналась — стартует новую и сама сессия
 * сразу считает это сообщение первым; иначе просто инкрементирует счётчик,
 * если он ещё не уперся в лимит. WHERE и SET в одном UPDATE читают старые
 * значения строки, поэтому два параллельных запроса не могут оба проскочить
 * мимо лимита. Возвращает true, если слот зарезервирован.
 */
function reserveDailySlot(userId, limit) {
  const result = run(
    `UPDATE eduardo_limits SET
       daily_used = CASE
         WHEN daily_started_at IS NULL OR (strftime('%s','now') - strftime('%s', daily_started_at)) >= 86400 THEN 1
         ELSE daily_used + 1
       END,
       daily_started_at = CASE
         WHEN daily_started_at IS NULL OR (strftime('%s','now') - strftime('%s', daily_started_at)) >= 86400 THEN datetime('now')
         ELSE daily_started_at
       END
     WHERE user_id = $userId
       AND (
         daily_started_at IS NULL
         OR (strftime('%s','now') - strftime('%s', daily_started_at)) >= 86400
         OR daily_used < $limit
       )`,
    { userId, limit },
  );
  return result.changes > 0;
}

/** Тот же атомарный приём для недельного окна, но сброс — по фиксированной границе (понедельник МСК), а не по давности. */
function reserveWeekSlot(userId, limit, weekStartIso) {
  const result = run(
    `UPDATE eduardo_limits SET
       week_used = CASE WHEN week_started_at IS NULL OR week_started_at < $weekStart THEN 1 ELSE week_used + 1 END,
       week_started_at = CASE WHEN week_started_at IS NULL OR week_started_at < $weekStart THEN $weekStart ELSE week_started_at END
     WHERE user_id = $userId
       AND (
         week_started_at IS NULL
         OR week_started_at < $weekStart
         OR week_used < $limit
       )`,
    { userId, limit, weekStart: weekStartIso },
  );
  return result.changes > 0;
}

function releaseDailySlot(userId) {
  run('UPDATE eduardo_limits SET daily_used = MAX(0, daily_used - 1) WHERE user_id = $userId', { userId });
}

function releaseWeekSlot(userId) {
  run('UPDATE eduardo_limits SET week_used = MAX(0, week_used - 1) WHERE user_id = $userId', { userId });
}

/**
 * Атомарно резервирует слот сразу в обоих окнах (день И неделя) — сообщение
 * разрешено, только если оба лимита не исчерпаны. Возвращает код отказа
 * ('daily' | 'week'), если резерв не удался (и откатывает частичный резерв).
 */
function reserveMessageSlot(userId, limits) {
  // UPDATE ниже требует существующей строки — у пользователя, который ни
  // разу не звал /usage и не отправлял сообщений, её ещё нет; без этого
  // INSERT первое же сообщение упёрлось бы в «лимит исчерпан» (UPDATE по
  // несуществующей строке всегда меняет 0 строк).
  run('INSERT OR IGNORE INTO eduardo_limits (user_id) VALUES ($userId)', { userId });
  if (!reserveDailySlot(userId, limits.dailyLimit)) return 'daily';
  if (!reserveWeekSlot(userId, limits.weekLimit, toDbTimestamp(currentWeekStart()))) {
    releaseDailySlot(userId);
    return 'week';
  }
  return null;
}

function releaseMessageSlot(userId) {
  releaseDailySlot(userId);
  releaseWeekSlot(userId);
}

function statFrom(used, limit) {
  const clampedUsed = Math.min(used, limit);
  return {
    used: clampedUsed,
    limit,
    remaining: Math.max(0, limit - clampedUsed),
    percent: limit > 0 ? Math.min(100, Math.round((clampedUsed / limit) * 100)) : 0,
  };
}

function usagePayload(user) {
  const limits = limitsFor(user);
  const row = limitsRow(user.id);
  const weekStart = currentWeekStart();
  const weekStartIso = toDbTimestamp(weekStart);

  // Если сохранённая граница недели устарела — для отображения считаем,
  // что счётчик уже обнулился (сам сброс в БД произойдёт атомарно при
  // следующей отправке сообщения, см. reserveWeekSlot).
  const weekActive = !!row.week_started_at && row.week_started_at >= weekStartIso;
  const week = statFrom(weekActive ? row.week_used : 0, limits.weekLimit);
  const nextWeekReset = new Date(weekStart.getTime() + WEEK_MS).toISOString();

  const dailyStartedAt = row.daily_started_at ? parseDbTimestamp(row.daily_started_at) : null;
  const dailyActive = !!dailyStartedAt && Date.now() - dailyStartedAt.getTime() < DAY_MS;
  const daily = statFrom(dailyActive ? row.daily_used : 0, limits.dailyLimit);
  const dailyResetAt = dailyActive ? new Date(dailyStartedAt.getTime() + DAY_MS).toISOString() : null;

  const imageUsage = usageRow(user.id, currentPeriod());

  return {
    pro: limits.pro,
    daily: { ...daily, active: dailyActive, resetAt: dailyResetAt },
    week: { ...week, resetAt: nextWeekReset },
    image: { used: imageUsage.image_used, limit: limits.imageLimit, remaining: Math.max(0, limits.imageLimit - imageUsage.image_used) },
  };
}

/** GET /api/eduardo/usage — текущие лимиты и расход за месяц. */
router.get('/usage', requireAuth, (req, res) => {
  res.json(usagePayload(req.user));
});

function shapeMessage(row) {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    simulated: !!row.simulated,
    createdAt: row.created_at,
  };
}

function shapeConversation(row) {
  return {
    id: row.id,
    title: row.title || 'Новый чат',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Возвращает id последнего по активности диалога пользователя, создавая его при отсутствии. */
function getOrCreateDefaultConversationId(userId) {
  const existing = get(
    'SELECT id FROM eduardo_conversations WHERE user_id = $userId ORDER BY updated_at DESC, id DESC LIMIT 1',
    { userId },
  );
  if (existing) return existing.id;
  const inserted = run('INSERT INTO eduardo_conversations (user_id) VALUES ($userId)', { userId });
  return inserted.lastInsertRowid;
}

/** Разбирает ?conversationId= из запроса, проверяя, что диалог принадлежит пользователю. */
function resolveConversationId(req) {
  const raw = req.query.conversationId;
  if (!raw) return getOrCreateDefaultConversationId(req.user.id);
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Некорректный chatId', 'bad_conversation');
  const row = get('SELECT id FROM eduardo_conversations WHERE id = $id AND user_id = $userId', { id, userId: req.user.id });
  if (!row) throw new HttpError(404, 'Чат не найден', 'conversation_not_found');
  return row.id;
}

/** GET /api/eduardo/conversations — список чатов пользователя, недавние сверху. */
router.get('/conversations', requireAuth, (req, res) => {
  const rows = all(
    'SELECT * FROM eduardo_conversations WHERE user_id = $userId ORDER BY updated_at DESC, id DESC',
    { userId: req.user.id },
  );
  res.json({ items: rows.map(shapeConversation) });
});

/** POST /api/eduardo/conversations — начать новый чат. */
router.post('/conversations', requireAuth, (req, res) => {
  const inserted = run('INSERT INTO eduardo_conversations (user_id) VALUES ($userId)', { userId: req.user.id });
  const row = get('SELECT * FROM eduardo_conversations WHERE id = $id', { id: inserted.lastInsertRowid });
  res.status(201).json(shapeConversation(row));
});

/** DELETE /api/eduardo/conversations/:id — удалить чат целиком вместе с сообщениями. */
router.delete(
  '/conversations/:id',
  requireAuth,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Некорректный chatId', 'bad_conversation');
    const result = run('DELETE FROM eduardo_conversations WHERE id = $id AND user_id = $userId', { id, userId: req.user.id });
    if (result.changes === 0) throw new HttpError(404, 'Чат не найден', 'conversation_not_found');
    res.status(204).end();
  }),
);

/** GET /api/eduardo/chat?conversationId= — история переписки (по умолчанию — последний активный чат). */
router.get(
  '/chat',
  requireAuth,
  wrap(async (req, res) => {
    const conversationId = resolveConversationId(req);
    const rows = all(
      `SELECT id, role, content, simulated, created_at FROM eduardo_messages
       WHERE conversation_id = $conversationId ORDER BY id ASC LIMIT 200`,
      { conversationId },
    );
    res.json({ conversationId, items: rows.map(shapeMessage) });
  }),
);

/** POST /api/eduardo/chat?conversationId= — отправить сообщение в чат с Eduardo. */
router.post(
  '/chat',
  requireAuth,
  wrap(async (req, res) => {
    const check = burstLimiter(`chat:${req.user.id}`);
    if (!check.ok) {
      res.set('Retry-After', String(check.retryAfter));
      throw new HttpError(429, `Слишком много запросов. Попробуйте через ${check.retryAfter} сек.`, 'rate_limited');
    }
    const message = text(req.body?.message, { max: 4000, min: 1, field: 'Сообщение', required: true });
    const conversationId = resolveConversationId(req);

    const limits = limitsFor(req.user);
    const denied = reserveMessageSlot(req.user.id, limits);
    if (denied === 'daily') {
      throw limitReached(
        `Дневная сессия Eduardo исчерпана (${limits.dailyLimit} сообщений за 24 часа). ${limits.pro ? 'Попробуйте позже.' : 'Оформите Pro, чтобы получить больше.'}`,
        'daily_limit_reached',
      );
    }
    if (denied === 'week') {
      throw limitReached(
        `Недельный лимит сообщений Eduardo исчерпан (${limits.weekLimit} в неделю, обновится в понедельник по московскому времени). ${limits.pro ? '' : 'Оформите Pro, чтобы получить больше.'}`,
        'week_limit_reached',
      );
    }

    const inserted = run(
      `INSERT INTO eduardo_messages (user_id, conversation_id, role, content) VALUES ($userId, $conversationId, 'user', $content)`,
      { userId: req.user.id, conversationId, content: message },
    );

    const history = all(
      `SELECT role, content FROM eduardo_messages WHERE conversation_id = $conversationId ORDER BY id DESC LIMIT $limit`,
      { conversationId, limit: CONTEXT_MESSAGES },
    ).reverse();

    let result;
    try {
      result = await generateChatReply({ messages: history });
    } catch (err) {
      releaseMessageSlot(req.user.id);
      run('DELETE FROM eduardo_messages WHERE id = $id', { id: inserted.lastInsertRowid });
      throw err;
    }

    const assistantInsert = run(
      `INSERT INTO eduardo_messages (user_id, conversation_id, role, content, simulated)
       VALUES ($userId, $conversationId, 'assistant', $content, $simulated)`,
      { userId: req.user.id, conversationId, content: result.text, simulated: result.simulated ? 1 : 0 },
    );
    const assistantRow = get('SELECT * FROM eduardo_messages WHERE id = $id', { id: assistantInsert.lastInsertRowid });

    // Заголовок чата — из первого сообщения пользователя (как в ChatGPT);
    // недавно активные чаты поднимаются в списке наверх.
    const conversation = get('SELECT title FROM eduardo_conversations WHERE id = $id', { id: conversationId });
    const title = conversation?.title || message.trim().slice(0, 60);
    run('UPDATE eduardo_conversations SET title = $title, updated_at = datetime(\'now\') WHERE id = $id', {
      id: conversationId,
      title,
    });

    res.json({ conversationId, message: shapeMessage(assistantRow), usage: usagePayload(req.user) });
  }),
);

/** DELETE /api/eduardo/chat?conversationId= — очистить сообщения текущего чата. */
router.delete(
  '/chat',
  requireAuth,
  wrap(async (req, res) => {
    const conversationId = resolveConversationId(req);
    run('DELETE FROM eduardo_messages WHERE conversation_id = $conversationId', { conversationId });
    res.status(204).end();
  }),
);

/** POST /api/eduardo/image — генерация изображения. */
router.post(
  '/image',
  requireAuth,
  wrap(async (req, res) => {
    const check = burstLimiter(`image:${req.user.id}`);
    if (!check.ok) {
      res.set('Retry-After', String(check.retryAfter));
      throw new HttpError(429, `Слишком много запросов. Попробуйте через ${check.retryAfter} сек.`, 'rate_limited');
    }
    if (!config.eduardo.imageEnabled) {
      throw new HttpError(503, 'Генерация изображений в Eduardo скоро будет доступна.', 'image_coming_soon');
    }

    const prompt = text(req.body?.prompt, { max: 800, min: 3, field: 'Запрос', required: true });

    const period = currentPeriod();
    const { imageLimit } = limitsFor(req.user);
    if (!tryReserveImageUsage(req.user.id, period, imageLimit)) {
      throw limitReached(
        `Лимит генераций изображений Eduardo исчерпан (${imageLimit} в месяц). Оформите Pro, чтобы получить больше.`,
      );
    }

    let result;
    try {
      result = await generateImage({ prompt });
    } catch (err) {
      releaseImageUsage(req.user.id, period);
      throw err;
    }
    run(
      `INSERT INTO eduardo_history (user_id, tool, prompt, result, image_url, simulated)
       VALUES ($userId, 'image', $prompt, '', $imageUrl, $simulated)`,
      { userId: req.user.id, prompt, imageUrl: result.url, simulated: result.simulated ? 1 : 0 },
    );

    res.json({ url: result.url, simulated: result.simulated, usage: usagePayload(req.user) });
  }),
);
