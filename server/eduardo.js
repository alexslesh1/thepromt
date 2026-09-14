/**
 * Движок Eduardo: чат с ИИ-помощником (через DeepSeek, модель «Eduardo-S1»)
 * и генерация изображений.
 *
 * Если в .env задан DEEPSEEK_API_KEY — чат зовёт настоящий DeepSeek API,
 * передавая ему всю историю переписки как контекст. Если ключа нет, работает
 * в честном демо-режиме: возвращает явно помеченный шаблонный результат
 * вместо того, чтобы притворяться настоящим ответом ИИ. Поле `simulated` в
 * ответе всегда говорит, какой режим сработал — интерфейс показывает это
 * пользователю.
 *
 * Генерация изображений (generateImage/placeholderSvg) пока не подключена
 * к интерфейсу — вкладка «Изображение» в Eduardo показывает «скоро будет
 * доступно» (см. config.eduardo.imageEnabled и routes/eduardo.js).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { run } from './db.js';

const EDUARDO_SYSTEM_PROMPT =
  'Ты — Eduardo, ИИ-помощник ThePrompt (модель Eduardo-S1). Помогаешь с промптами для нейросетей, отвечаешь на вопросы, пишешь код, составляешь тесты и объясняешь темы. Отвечай по делу, кратко и точно, на языке пользователя (обычно русский), код оформляй в блоках ```.';

const CODE_REQUEST_RE = /код|function|функци|программ|script|скрипт/i;

function simulatedReply(prompt) {
  const banner = 'Демо-ответ Eduardo (на сервере не настроен DEEPSEEK_API_KEY — это шаблон, а не результат работы нейросети).';
  const trimmedPrompt = prompt.length > 200 ? `${prompt.slice(0, 200)}…` : prompt;
  // Заголовок и жирный текст здесь не для красоты — шаблон нарочно использует
  // markdown, чтобы демо-режим проверял тот же рендеринг, что и настоящие
  // ответы DeepSeek (см. public/js/markdown.js).
  const lines = [
    banner,
    '',
    '## Ваш запрос',
    `Сообщение: **«${trimmedPrompt}»**`,
    '',
    'Настоящий ответ появится здесь после настройки ключа API.',
  ];
  if (CODE_REQUEST_RE.test(prompt)) {
    lines.push(
      '',
      'Пример оформления кода в демо-режиме:',
      '```javascript',
      '// Демо-заглушка — настоящий код появится после настройки DEEPSEEK_API_KEY',
      'function solve() {',
      '  throw new Error("demo");',
      '}',
      '```',
    );
  }
  return lines.join('\n');
}

/**
 * Отправляет DeepSeek всю историю чата (уже включая новое сообщение
 * пользователя) как контекст и возвращает ответ ассистента.
 * @param {{messages: {role: 'user'|'assistant', content: string}[]}} args
 */
export async function generateChatReply({ messages }) {
  if (!config.ai.deepseekKey) {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    return { text: simulatedReply(lastUser), simulated: true };
  }

  // Свой AbortController вместо AbortSignal.timeout(): у последнего таймер
  // не привязан к времени жизни запроса и продолжает тикать в фоне даже
  // после того, как всё уже завершилось — если он срабатывает позже, Node
  // печатает необработанный DOMException прямо в консоль сервера.
  // clearTimeout в finally гарантирует, что этого не произойдёт. Таймер
  // держим живым до КОНЦА чтения тела ответа (res.json() ниже), а не
  // только до получения заголовков — иначе именно чтение тела остаётся
  // без защиты от зависания и запрос может висеть бесконечно.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.ai.deepseekKey}`,
      },
      body: JSON.stringify({
        model: config.ai.deepseekModel,
        max_tokens: 1200,
        messages: [
          { role: 'system', content: EDUARDO_SYSTEM_PROMPT },
          ...messages.map((m) => ({ role: m.role, content: m.content })),
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`DeepSeek API вернул ошибку ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = await res.json();
    const text = json.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('DeepSeek API вернул пустой ответ');
    return { text, simulated: false };
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error('DeepSeek не ответил вовремя, попробуйте ещё раз.');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/** Детерминированный, но разный для разных промптов градиент-плейсхолдер. */
function placeholderSvg(prompt) {
  const hash = crypto.createHash('sha1').update(prompt).digest();
  const hue1 = hash[0] % 360;
  const hue2 = (hue1 + 60 + (hash[1] % 120)) % 360;
  const words = prompt.trim().split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    if ((line + ' ' + word).trim().length > 28) {
      lines.push(line.trim());
      line = word;
    } else {
      line = `${line} ${word}`;
    }
    if (lines.length >= 4) break;
  }
  if (line.trim() && lines.length < 4) lines.push(line.trim());
  const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const textLines = lines
    .map((l, i) => `<text x="512" y="${470 + i * 46}" text-anchor="middle" font-family="sans-serif" font-size="34" fill="#ffffff" opacity="0.92">${escape(l)}</text>`)
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="hsl(${hue1},70%,45%)"/>
        <stop offset="100%" stop-color="hsl(${hue2},70%,35%)"/>
      </linearGradient>
    </defs>
    <rect width="1024" height="1024" fill="url(#g)"/>
    <circle cx="512" cy="330" r="90" fill="#ffffff" opacity="0.14"/>
    <path d="M472 300h60a30 30 0 0 1 0 60h-40l-30 30v-30h-10a30 30 0 0 1 0-60z" fill="#ffffff" opacity="0.85"/>
    <text x="512" y="620" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#ffffff" opacity="0.75">Демо-изображение Eduardo</text>
    ${textLines}
  </svg>`;
}

/** @param {{prompt: string}} */
export async function generateImage({ prompt }) {
  if (!config.ai.openaiKey) {
    const svg = placeholderSvg(prompt);
    const name = `eduardo-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.svg`;
    fs.writeFileSync(path.join(config.uploadsDir, name), svg, 'utf8');
    return { url: `/uploads/${name}`, simulated: true };
  }

  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.ai.openaiKey}` },
    body: JSON.stringify({
      model: config.ai.openaiImageModel,
      prompt,
      size: '1024x1024',
      n: 1,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI Images API вернул ошибку ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  const item = json.data?.[0];
  let buffer;
  if (item?.b64_json) {
    buffer = Buffer.from(item.b64_json, 'base64');
  } else if (item?.url) {
    const imgRes = await fetch(item.url);
    if (!imgRes.ok) throw new Error('Не удалось скачать сгенерированное изображение');
    buffer = Buffer.from(await imgRes.arrayBuffer());
  } else {
    throw new Error('OpenAI Images API не вернул изображение');
  }
  const name = `eduardo-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.png`;
  fs.writeFileSync(path.join(config.uploadsDir, name), buffer);
  return { url: `/uploads/${name}`, simulated: false };
}

/**
 * Лимиты Eduardo считаются помесячно (period = 'YYYY-MM' в eduardo_usage) —
 * новый месяц сам по себе даёт пользователю новый пустой счётчик, отдельного
 * «сброса» для этого не нужно. Эта функция — фоновая уборка: раз в сутки
 * удаляет строки за прошлые месяцы, чтобы таблица не росла бесконечно.
 */
export function pruneOldEduardoUsage() {
  const currentPeriod = new Date().toISOString().slice(0, 7);
  run('DELETE FROM eduardo_usage WHERE period < $currentPeriod', { currentPeriod });
}

function msUntilNextUtcMidnight() {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0);
  return next - now.getTime();
}

/** Запускает pruneOldEduardoUsage() сразу и затем каждые сутки в 00:00 UTC. */
export function scheduleEduardoUsageCleanup() {
  pruneOldEduardoUsage();
  const tick = () => {
    pruneOldEduardoUsage();
    setTimeout(tick, 24 * 60 * 60 * 1000).unref();
  };
  setTimeout(tick, msUntilNextUtcMidnight()).unref();
}
