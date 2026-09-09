/**
 * Раздел Eduardo — чат с ИИ-помощником и генерация изображений.
 * Лимиты считаются помесячно и зависят от Pro.
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

// Помесячная квота — это лимит расходов, а этот лимитер — защита от того,
// чтобы один пользователь не заваливал сервер и внешний AI API запросами
// пачками (даже в пределах своей квоты).
const burstLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 10 });

const currentPeriod = () => new Date().toISOString().slice(0, 7); // 'YYYY-MM'

function limitsFor(user) {
  const pro = isProActive(user);
  return {
    pro,
    textLimit: pro ? config.eduardo.proTextLimit : config.eduardo.freeTextLimit,
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

/**
 * Атомарно резервирует слот лимита: инкремент и проверка «не больше limit»
 * происходят одним SQL-запросом, поэтому два параллельных запроса от одного
 * пользователя не могут оба проскочить мимо лимита (в отличие от
 * «прочитать счётчик, потом отдельно инкрементировать» с await между ними).
 * Возвращает true, если слот зарезервирован; при неудаче ничего не меняет.
 */
function tryReserveUsage(userId, period, field, limit) {
  const result = run(
    `INSERT INTO eduardo_usage (user_id, period, ${field}) VALUES ($userId, $period, 1)
     ON CONFLICT(user_id, period) DO UPDATE SET ${field} = ${field} + 1 WHERE ${field} < $limit`,
    { userId, period, limit },
  );
  return result.changes > 0;
}

/** Откатывает резерв, если сама генерация не удалась. */
function releaseUsage(userId, period, field) {
  run(
    `UPDATE eduardo_usage SET ${field} = MAX(0, ${field} - 1) WHERE user_id = $userId AND period = $period`,
    { userId, period },
  );
}

function usagePayload(user) {
  const period = currentPeriod();
  const usage = usageRow(user.id, period);
  const limits = limitsFor(user);
  return {
    period,
    pro: limits.pro,
    text: { used: usage.text_used, limit: limits.textLimit, remaining: Math.max(0, limits.textLimit - usage.text_used) },
    image: { used: usage.image_used, limit: limits.imageLimit, remaining: Math.max(0, limits.imageLimit - usage.image_used) },
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

/** GET /api/eduardo/chat — история переписки с Eduardo. */
router.get('/chat', requireAuth, (req, res) => {
  const rows = all(
    `SELECT id, role, content, simulated, created_at FROM eduardo_messages
     WHERE user_id = $userId ORDER BY id ASC LIMIT 200`,
    { userId: req.user.id },
  );
  res.json({ items: rows.map(shapeMessage) });
});

/** POST /api/eduardo/chat — отправить сообщение в чат с Eduardo. */
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

    const period = currentPeriod();
    const { textLimit } = limitsFor(req.user);
    if (!tryReserveUsage(req.user.id, period, 'text_used', textLimit)) {
      throw limitReached(
        `Лимит сообщений Eduardo исчерпан (${textLimit} в месяц). Оформите Pro, чтобы получить больше.`,
      );
    }

    const inserted = run('INSERT INTO eduardo_messages (user_id, role, content) VALUES ($userId, \'user\', $content)', {
      userId: req.user.id,
      content: message,
    });

    const history = all(
      `SELECT role, content FROM eduardo_messages WHERE user_id = $userId ORDER BY id DESC LIMIT $limit`,
      { userId: req.user.id, limit: CONTEXT_MESSAGES },
    ).reverse();

    let result;
    try {
      result = await generateChatReply({ messages: history });
    } catch (err) {
      releaseUsage(req.user.id, period, 'text_used');
      run('DELETE FROM eduardo_messages WHERE id = $id', { id: inserted.lastInsertRowid });
      throw err;
    }

    const assistantInsert = run(
      `INSERT INTO eduardo_messages (user_id, role, content, simulated) VALUES ($userId, 'assistant', $content, $simulated)`,
      { userId: req.user.id, content: result.text, simulated: result.simulated ? 1 : 0 },
    );
    const assistantRow = get('SELECT * FROM eduardo_messages WHERE id = $id', { id: assistantInsert.lastInsertRowid });

    res.json({ message: shapeMessage(assistantRow), usage: usagePayload(req.user) });
  }),
);

/** DELETE /api/eduardo/chat — очистить историю переписки. */
router.delete('/chat', requireAuth, (req, res) => {
  run('DELETE FROM eduardo_messages WHERE user_id = $userId', { userId: req.user.id });
  res.status(204).end();
});

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
    if (!tryReserveUsage(req.user.id, period, 'image_used', imageLimit)) {
      throw limitReached(
        `Лимит генераций изображений Eduardo исчерпан (${imageLimit} в месяц). Оформите Pro, чтобы получить больше.`,
      );
    }

    let result;
    try {
      result = await generateImage({ prompt });
    } catch (err) {
      releaseUsage(req.user.id, period, 'image_used');
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
