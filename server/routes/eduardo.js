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
import { HttpError, badRequest, limitReached, text, wrap } from '../util.js';

export const router = express.Router();

const TOOLS = ['qa', 'test', 'code'];

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

function bumpUsage(userId, period, field) {
  run(
    `INSERT INTO eduardo_usage (user_id, period, ${field}) VALUES ($userId, $period, 1)
     ON CONFLICT(user_id, period) DO UPDATE SET ${field} = ${field} + 1`,
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
    const tool = String(req.body?.tool ?? 'qa');
    if (!TOOLS.includes(tool)) throw badRequest('Неизвестный инструмент');
    const prompt = text(req.body?.prompt, { max: 4000, min: 3, field: 'Запрос', required: true });

    const period = currentPeriod();
    const { textLimit } = limitsFor(req.user);
    const usage = usageRow(req.user.id, period);
    if (usage.text_used >= textLimit) {
      throw limitReached(
        `Лимит текстовых запросов Eduardo исчерпан (${textLimit} в месяц). Оформите Pro, чтобы получить больше.`,
      );
    }

    const result = await generateText({ tool, prompt });
    bumpUsage(req.user.id, period, 'text_used');
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
    if (!config.eduardo.imageEnabled) {
      throw new HttpError(503, 'Генерация изображений в Eduardo скоро будет доступна.', 'image_coming_soon');
    }

    const prompt = text(req.body?.prompt, { max: 800, min: 3, field: 'Запрос', required: true });

    const period = currentPeriod();
    const { imageLimit } = limitsFor(req.user);
    const usage = usageRow(req.user.id, period);
    if (usage.image_used >= imageLimit) {
      throw limitReached(
        `Лимит генераций изображений Eduardo исчерпан (${imageLimit} в месяц). Оформите Pro, чтобы получить больше.`,
      );
    }

    const result = await generateImage({ prompt });
    bumpUsage(req.user.id, period, 'image_used');
    run(
      `INSERT INTO eduardo_history (user_id, tool, prompt, result, image_url, simulated)
       VALUES ($userId, 'image', $prompt, '', $imageUrl, $simulated)`,
      { userId: req.user.id, prompt, imageUrl: result.url, simulated: result.simulated ? 1 : 0 },
    );

    res.json({ url: result.url, simulated: result.simulated, usage: usagePayload(req.user) });
  }),
);
