/**
 * Движок Eduardo: генерация текста/кода/тестов и изображений.
 *
 * Если в .env заданы ключи — вызывает настоящие API (Anthropic для текста,
 * OpenAI Images для картинок). Если ключей нет, работает в честном
 * демо-режиме: возвращает явно помеченный шаблонный результат вместо того,
 * чтобы притворяться настоящим ответом ИИ. Поле `simulated` в ответе всегда
 * говорит, какой режим сработал — интерфейс показывает это пользователю.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const SYSTEM_PROMPTS = {
  qa: 'Ты — Eduardo, помощник ThePrompt. Отвечай на вопрос пользователя кратко, точно и по делу, на русском языке.',
  test: 'Ты — Eduardo, помощник ThePrompt. По теме пользователя составь короткий тест: 3 вопроса с 4 вариантами ответа и правильным ответом в конце. Отвечай на русском языке.',
  code: 'Ты — Eduardo, помощник ThePrompt по программированию. Напиши рабочий код для задачи пользователя, кратко поясни решение. Если язык программирования не указан явно, выбери наиболее уместный и укажи его.',
};

function simulatedText(tool, prompt) {
  const banner = 'Демо-ответ Eduardo (на сервере не настроен ANTHROPIC_API_KEY — это шаблон, а не результат работы нейросети).';
  const trimmedPrompt = prompt.length > 200 ? `${prompt.slice(0, 200)}…` : prompt;

  if (tool === 'test') {
    return [
      banner,
      '',
      `Тема: «${trimmedPrompt}»`,
      '',
      '1. Пример вопроса по теме?',
      '   A) Вариант A   B) Вариант B   C) Вариант C   D) Вариант D',
      '2. Ещё один пример вопроса?',
      '   A) Вариант A   B) Вариант B   C) Вариант C   D) Вариант D',
      '3. И третий пример вопроса?',
      '   A) Вариант A   B) Вариант B   C) Вариант C   D) Вариант D',
      '',
      'Правильные ответы: 1-A, 2-B, 3-C (демо-заглушка).',
    ].join('\n');
  }

  if (tool === 'code') {
    return [
      banner,
      '',
      '```',
      `// Задача: ${trimmedPrompt}`,
      'function solve() {',
      '  // TODO: здесь будет реализация от настоящей модели',
      '  throw new Error("Демо-заглушка — подключите ANTHROPIC_API_KEY для настоящей генерации кода");',
      '}',
      '```',
    ].join('\n');
  }

  return [banner, '', `Ваш вопрос: «${trimmedPrompt}»`, '', 'Настоящий ответ появится здесь после настройки ключа API.'].join('\n');
}

/** @param {{tool: 'qa'|'test'|'code', prompt: string}} */
export async function generateText({ tool, prompt }) {
  if (!config.ai.anthropicKey) {
    return { text: simulatedText(tool, prompt), simulated: true };
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.ai.anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.ai.anthropicModel,
      max_tokens: 1200,
      system: SYSTEM_PROMPTS[tool] ?? SYSTEM_PROMPTS.qa,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Anthropic API вернул ошибку ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  const text = json.content?.map((block) => block.text ?? '').join('\n').trim();
  if (!text) throw new Error('Anthropic API вернул пустой ответ');
  return { text, simulated: false };
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
