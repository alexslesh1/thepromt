import crypto from 'node:crypto';
import { LIMITS } from './constants.js';

/** Ошибка с HTTP-статусом — перехватывается общим обработчиком. */
export class HttpError extends Error {
  constructor(status, message, code = undefined) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (message, code) => new HttpError(400, message, code);
export const unauthorized = (message = 'Требуется вход') => new HttpError(401, message);
export const forbidden = (message = 'Недостаточно прав') => new HttpError(403, message);
export const notFound = (message = 'Не найдено') => new HttpError(404, message);

/** Оборачивает async-обработчик, чтобы отказы уходили в next(). */
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export const nowIso = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

export const isoPlus = (ms) =>
  new Date(Date.now() + ms).toISOString().replace('T', ' ').slice(0, 19);

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

/** Сравнение строк с постоянным временем. */
export function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function generateOtp(length = 6) {
  let code = '';
  while (code.length < length) code += crypto.randomInt(0, 10);
  return code;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(value) {
  const email = String(value ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) {
    throw badRequest('Некорректный email');
  }
  return email;
}

const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export function normalizeUsername(value) {
  const username = String(value ?? '').trim().toLowerCase().replace(/^@/, '');
  if (!USERNAME_RE.test(username)) {
    throw badRequest('Никнейм: 3–20 символов, только латиница, цифры и _');
  }
  return username;
}

/** Обрезает и валидирует текстовое поле. */
export function text(value, { max, min = 0, field = 'Поле', required = false } = {}) {
  const str = String(value ?? '').trim();
  if (!str) {
    if (required || min > 0) throw badRequest(`${field}: обязательное поле`);
    return '';
  }
  if (str.length < min) throw badRequest(`${field}: минимум ${min} символов`);
  if (max && str.length > max) throw badRequest(`${field}: максимум ${max} символов`);
  return str;
}

export function normalizeTags(input) {
  const raw = Array.isArray(input)
    ? input
    : String(input ?? '')
        .split(/[,\n]/)
        .map((t) => t);
  const seen = new Set();
  const tags = [];
  for (const item of raw) {
    const tag = String(item ?? '')
      .trim()
      .toLowerCase()
      .replace(/^#/, '')
      .replace(/\s+/g, '-')
      .slice(0, LIMITS.tagLength);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= LIMITS.tagsPerPost) break;
  }
  return tags;
}

export function clampInt(value, { min, max, fallback }) {
  const num = Number.parseInt(value, 10);
  if (Number.isNaN(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

/** Простой ограничитель частоты запросов в памяти процесса. */
export function createRateLimiter({ windowMs, max }) {
  const hits = new Map();
  return function check(key) {
    const now = Date.now();
    const list = (hits.get(key) ?? []).filter((ts) => now - ts < windowMs);
    if (list.length >= max) {
      list.sort((a, b) => a - b);
      const retryAfter = Math.ceil((windowMs - (now - list[0])) / 1000);
      hits.set(key, list);
      return { ok: false, retryAfter };
    }
    list.push(now);
    hits.set(key, list);
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (v.every((ts) => now - ts >= windowMs)) hits.delete(k);
    }
    return { ok: true, retryAfter: 0 };
  };
}
