/**
 * Раздел Eduardo — ИИ-инструмент: вопрос-ответ/тесты, генерация кода,
 * генерация изображений. Лимиты считаются помесячно и зависят от Pro.
 */
import express from 'express';
import { config } from '../config.js';
import { all, get, run } from '../db.js';
import { requireAuth } from '../auth.js';
import { generateImage, generateText } from '../eduardo.js';
import { isProActive } from '../store.js';
import { HttpError, badRequest, createRateLimiter, limitReached, text, wrap } from '../util.js';

export const router = express.Router();

const TOOLS = ['qa', 'test', 'code'];

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

/** GET /api/eduardo/history — последние генерации пользователя. */
router.get('/history', requireAuth, (req, res) => {
  const rows = all(
    `SELECT id, tool, prompt, result, image_url, simulated, created_at
     FROM eduardo_history WHERE user_id = $userId ORDER BY id DESC LIMIT 30`,
    { userId: req.user.id },
  );
  res.json({
    items: rows.map((r) => ({
      id: r.id,
      tool: r.tool,
      prompt: r.prompt,
      result: r.result,
      imageUrl: r.image_url,
      simulated: !!r.simulated,
      createdAt: r.created_at,
    })),
  });
});

/** POST /api/eduardo/text — вопрос-ответ, тест или код. */
router.post(
  '/text',
  requireAuth,
  wrap(async (req, res) => {
    const check = burstLimiter(`text:${req.user.id}`);
    if (!check.ok) {
      res.set('Retry-After', String(check.retryAfter));
      throw new HttpError(429, `Слишком много запросов. Попробуйте через ${check.retryAfter} сек.`, 'rate_limited');
    }
    const tool = String(req.body?.tool ?? 'qa');
    if (!TOOLS.includes(tool)) throw badRequest('Неизвестный инструмент');
    const prompt = text(req.body?.prompt, { max: 4000, min: 3, field: 'Запрос', required: true });

    const period = currentPeriod();
    const { textLimit } = limitsFor(req.user);
    if (!tryReserveUsage(req.user.id, period, 'text_used', textLimit)) {
      throw limitReached(
        `Лимит текстовых запросов Eduardo исчерпан (${textLimit} в месяц). Оформите Pro, чтобы получить больше.`,
      );
    }

    let result;
    try {
      result = await generateText({ tool, prompt });
    } catch (err) {
      releaseUsage(req.user.id, period, 'text_used');
      throw err;
    }
    run(
      `INSERT INTO eduardo_history (user_id, tool, prompt, result, simulated) VALUES ($userId, $tool, $prompt, $result, $simulated)`,
      { userId: req.user.id, tool, prompt, result: result.text, simulated: result.simulated ? 1 : 0 },
    );

    res.json({ result: result.text, simulated: result.simulated, usage: usagePayload(req.user) });
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
