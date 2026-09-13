import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..');

/** Минимальный парсер .env — чтобы не тянуть лишнюю зависимость. */
function loadDotEnv() {
  const file = path.join(ROOT_DIR, '.env');
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadDotEnv();

const env = process.env;
const bool = (value, fallback = false) =>
  value === undefined ? fallback : ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());

/**
 * Файл базы по умолчанию. Если рядом лежит база от предыдущей версии
 * проекта (promptshare.db), используем её — данные не теряются.
 */
function defaultDbFile() {
  const dataDir = path.join(ROOT_DIR, 'data');
  const legacy = path.join(dataDir, 'promptshare.db');
  if (fs.existsSync(legacy)) return legacy;
  return path.join(dataDir, 'theprompt.db');
}

export const config = {
  env: env.NODE_ENV || 'development',
  get isProduction() {
    return this.env === 'production';
  },
  port: Number(env.PORT || 3000),
  sessionSecret: env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  dataDir: path.join(ROOT_DIR, 'data'),
  dbFile: env.DB_FILE || defaultDbFile(),
  uploadsDir: path.join(ROOT_DIR, 'uploads'),
  publicDir: path.join(ROOT_DIR, 'public'),
  adminEmails: (env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
  mail: {
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT || 587),
    secure: bool(env.SMTP_SECURE, false),
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.MAIL_FROM || 'ThePrompt <no-reply@theprompt.local>',
  },
  otp: {
    length: 6,
    ttlMinutes: 10,
    maxAttempts: 5,
    resendCooldownSeconds: 60,
  },
  session: {
    cookieName: 'ps_session',
    ttlDays: 30,
  },
  uploads: {
    maxBytes: 5 * 1024 * 1024,
    allowedMime: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  },
  feed: {
    pageSize: 20,
  },
  appUrl: env.APP_URL || `http://localhost:${Number(env.PORT || 3000)}`,
  oauth: {
    github: { clientId: env.GITHUB_CLIENT_ID || '', clientSecret: env.GITHUB_CLIENT_SECRET || '' },
    google: { clientId: env.GOOGLE_CLIENT_ID || '', clientSecret: env.GOOGLE_CLIENT_SECRET || '' },
    microsoft: { clientId: env.MICROSOFT_CLIENT_ID || '', clientSecret: env.MICROSOFT_CLIENT_SECRET || '' },
    discord: { clientId: env.DISCORD_CLIENT_ID || '', clientSecret: env.DISCORD_CLIENT_SECRET || '' },
  },
  ai: {
    openaiKey: env.OPENAI_API_KEY || '',
    openaiImageModel: env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
    deepseekKey: env.DEEPSEEK_API_KEY || '',
    deepseekModel: env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
  },
  testPrompt: {
    maxPromptLength: 4000,
    maxTokens: 1000,
    timeoutMs: 20000,
    rateLimit: { windowMs: 60 * 1000, max: 10 },
  },
  eduardo: {
    // Сообщения ограничены двумя параллельными окнами (оба должны быть не
    // исчерпаны): «дневная сессия» — 24 часа с первого сообщения (не
    // календарные сутки), и «неделя» — сбрасывается по понедельникам в
    // 00:00 по московскому времени.
    freeDailyLimit: 20,
    freeWeekLimit: 100,
    proDailyLimit: 100,
    proWeekLimit: 500,
    freeImageLimit: 1,
    proImageLimit: 3,
    // Генерация изображений временно отключена — вкладка показывает
    // «скоро будет доступно» вместо формы, пока эта фича не готова.
    imageEnabled: false,
  },
  pro: {
    priceLabel: '$10 / месяц',
    durationDays: 30,
  },
};

/**
 * В dev-режиме без настроенного SMTP код подтверждения возвращается
 * прямо в ответе API, чтобы приложением можно было пользоваться сразу.
 */
export const devCodesEnabled = !config.isProduction && !config.mail.host;

for (const dir of [config.dataDir, config.uploadsDir]) {
  fs.mkdirSync(dir, { recursive: true });
}
