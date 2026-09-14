/**
 * POST /api/test-prompt — прогоняет произвольный промпт через DeepSeek,
 * чтобы можно было быстро протестировать его вне основного UI.
 *
 * Ключ DeepSeek никогда не попадает в ответ клиенту; при ошибках API
 * (невалидный ключ, нет баланса, таймаут) клиент получает понятное
 * сообщение, а технические детали уходят только в серверный лог.
 */
import express from 'express';
import { config } from '../config.js';
import { HttpError, createRateLimiter, text, wrap } from '../util.js';

export const router = express.Router();

const limiter = createRateLimiter(config.testPrompt.rateLimit);

router.post(
  '/',
  wrap(async (req, res) => {
    const check = limiter(req.ip || 'unknown');
    if (!check.ok) {
      res.set('Retry-After', String(check.retryAfter));
      throw new HttpError(
        429,
        `Слишком много запросов. Попробуйте снова через ${check.retryAfter} сек.`,
        'rate_limited',
      );
    }

    const prompt = text(req.body?.prompt, {
      max: config.testPrompt.maxPromptLength,
      field: 'Промпт',
      required: true,
    });

    if (!config.ai.deepseekKey) {
      throw new HttpError(
        503,
        'DeepSeek API не настроен на сервере — задайте DEEPSEEK_API_KEY в .env.',
        'deepseek_not_configured',
      );
    }

    // Свой AbortController вместо AbortSignal.timeout(): у последнего таймер
    // не привязан к времени жизни запроса и продолжает тикать в фоне даже
    // после того, как fetch уже завершился — если он срабатывает позже,
    // Node печатает необработанный DOMException прямо в консоль сервера.
    // clearTimeout в finally гарантирует, что этого не произойдёт.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.testPrompt.timeoutMs);
    let response;
    try {
      response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.ai.deepseekKey}`,
        },
        body: JSON.stringify({
          model: config.ai.deepseekModel,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: config.testPrompt.maxTokens,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        throw new HttpError(504, 'DeepSeek не ответил вовремя. Попробуйте ещё раз.', 'deepseek_timeout');
      }
      console.error('[test-prompt] сеть до DeepSeek недоступна:', err);
      throw new HttpError(502, 'Не удалось связаться с DeepSeek. Попробуйте позже.', 'deepseek_unreachable');
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      console.error(`[test-prompt] DeepSeek ответил ${response.status}: ${bodyText.slice(0, 500)}`);
      if (response.status === 401 || response.status === 403) {
        throw new HttpError(502, 'DeepSeek отклонил ключ API. Проверьте настройки на сервере.', 'deepseek_auth');
      }
      if (response.status === 402) {
        throw new HttpError(502, 'На балансе DeepSeek недостаточно средств. Обратитесь к администратору.', 'deepseek_balance');
      }
      if (response.status === 429) {
        throw new HttpError(429, 'DeepSeek временно ограничивает запросы. Попробуйте через минуту.', 'deepseek_rate_limited');
      }
      throw new HttpError(502, 'DeepSeek сейчас недоступен. Попробуйте позже.', 'deepseek_error');
    }

    const json = await response.json().catch(() => null);
    const content = json?.choices?.[0]?.message?.content?.trim();
    if (!content) {
      console.error('[test-prompt] DeepSeek вернул пустой ответ:', JSON.stringify(json).slice(0, 500));
      throw new HttpError(502, 'DeepSeek вернул пустой ответ. Попробуйте переформулировать запрос.', 'deepseek_empty');
    }

    res.json({ text: content });
  }),
);
