import path from 'node:path';
import express from 'express';
import { config } from './config.js';
import { closeDb } from './db.js';
import { attachUser } from './auth.js';
import { mailerMode, devCodesEnabled } from './mailer.js';
import {
  CATEGORIES,
  DIFFICULTIES,
  LIMITS,
  MODEL_FAMILIES,
  REPORT_REASONS,
  SORT_OPTIONS,
  SUGGESTED_TAGS,
} from './constants.js';
import { suggestedUsers, topCategories, topModels, trendingTags } from './store.js';
import { HttpError, wrap } from './util.js';
import { router as authRouter, cleanupExpired } from './routes/auth.js';
import { router as oauthRouter } from './routes/oauth.js';
import { commentsRouter, router as postsRouter } from './routes/posts.js';
import { meRouter, router as usersRouter, searchRouter } from './routes/users.js';
import { router as uploadsRouter } from './routes/uploads.js';
import { router as notificationsRouter } from './routes/notifications.js';
import { router as adminRouter } from './routes/admin.js';
import { router as proRouter } from './routes/pro.js';
import { router as eduardoRouter } from './routes/eduardo.js';

export const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

/** Разбор cookie без внешних зависимостей. */
app.use((req, _res, next) => {
  const header = req.headers.cookie;
  const jar = {};
  if (header) {
    for (const part of header.split(';')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      const key = part.slice(0, eq).trim();
      if (!key) continue;
      try {
        jar[key] = decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        jar[key] = part.slice(eq + 1).trim();
      }
    }
  }
  req.cookies = jar;
  next();
});

app.use((_req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'same-origin');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  next();
});

app.use(attachUser);

/**
 * Простая защита от CSRF: изменяющие запросы должны приходить от нашего же
 * фронтенда, который всегда шлёт заголовок X-Requested-With.
 */
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') === 'ThePrompt') return next();
  res.status(403).json({ error: 'Некорректный источник запроса' });
});

/* ------------------------------ API ------------------------------- */

app.get('/api/meta', (req, res) => {
  res.json({
    models: MODEL_FAMILIES,
    difficulties: DIFFICULTIES,
    categories: CATEGORIES,
    sortOptions: SORT_OPTIONS,
    reportReasons: REPORT_REASONS,
    suggestedTags: SUGGESTED_TAGS,
    limits: LIMITS,
    mailerMode,
    devCodesEnabled,
    pro: { priceLabel: config.pro.priceLabel, durationDays: config.pro.durationDays },
    eduardo: {
      freeTextLimit: config.eduardo.freeTextLimit,
      freeImageLimit: config.eduardo.freeImageLimit,
      proTextLimit: config.eduardo.proTextLimit,
      proImageLimit: config.eduardo.proImageLimit,
      textSimulated: !config.ai.anthropicKey,
      imageSimulated: !config.ai.openaiKey,
    },
    user: req.user
      ? {
          id: req.user.id,
          username: req.user.username,
          theme: req.user.theme,
          role: req.user.role,
        }
      : null,
  });
});

app.get(
  '/api/sidebar',
  wrap(async (req, res) => {
    res.json({
      trendingTags: trendingTags(12),
      topModels: topModels(4),
      topCategories: topCategories(6),
      suggestedUsers: req.user ? suggestedUsers(req.user.id, 3) : suggestedUsers(0, 3),
    });
  }),
);

app.use('/api/auth/oauth', oauthRouter);
app.use('/api/auth', authRouter);
app.use('/api/posts', postsRouter);
app.use('/api/comments', commentsRouter);
app.use('/api/users', usersRouter);
app.use('/api/me', meRouter);
app.use('/api/search', searchRouter);
app.use('/api/uploads', uploadsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/pro', proRouter);
app.use('/api/eduardo', eduardoRouter);

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Метод API не найден' });
});

/* --------------------------- Статика ------------------------------ */

app.use(
  '/uploads',
  express.static(config.uploadsDir, {
    maxAge: '7d',
    setHeaders: (res) => res.set('Content-Disposition', 'inline'),
  }),
);
app.use(express.static(config.publicDir, { maxAge: config.isProduction ? '1h' : 0 }));

// SPA: любой не-API маршрут отдаёт index.html.
app.get(/^\/(?!api|uploads).*/, (_req, res) => {
  res.sendFile(path.join(config.publicDir, 'index.html'));
});

/* ------------------------ Обработка ошибок ------------------------ */

app.use((error, _req, res, _next) => {
  const status = error instanceof HttpError ? error.status : error.status || 500;
  if (status >= 500) console.error('[error]', error);
  res.status(status).json({
    error: status >= 500 ? 'Внутренняя ошибка сервера' : error.message,
    code: error.code,
  });
});

/* ----------------------------- Запуск ----------------------------- */

if (process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`) {
  cleanupExpired();
  setInterval(cleanupExpired, 60 * 60 * 1000).unref();

  const server = app.listen(config.port, () => {
    console.log(`ThePrompt запущен: http://localhost:${config.port}`);
    console.log(`Режим: ${config.env}; почта: ${mailerMode}${devCodesEnabled ? ' (код придёт в ответе API и в консоль)' : ''}`);
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      server.close(() => {
        closeDb();
        process.exit(0);
      });
    });
  }
}
