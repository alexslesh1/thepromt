import crypto from 'node:crypto';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { requireAuth } from '../auth.js';
import { badRequest, wrap } from '../util.js';

export const router = express.Router();

const EXT_BY_MIME = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadsDir),
  filename: (_req, file, cb) => {
    const ext = EXT_BY_MIME[file.mimetype] ?? '.bin';
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.uploads.maxBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!config.uploads.allowedMime.includes(file.mimetype)) {
      cb(badRequest('Поддерживаются только изображения PNG, JPEG, WebP и GIF'));
      return;
    }
    cb(null, true);
  },
});

/** POST /api/uploads — загрузка изображения (аватар, баннер, пример результата). */
router.post(
  '/',
  requireAuth,
  (req, res, next) => {
    upload.single('file')(req, res, (error) => {
      if (!error) return next();
      if (error.code === 'LIMIT_FILE_SIZE') {
        return next(badRequest(`Файл больше ${Math.round(config.uploads.maxBytes / 1024 / 1024)} МБ`));
      }
      next(error);
    });
  },
  wrap(async (req, res) => {
    if (!req.file) throw badRequest('Файл не получен');
    const url = `/uploads/${path.basename(req.file.filename)}`;
    res.status(201).json({ url, size: req.file.size, mime: req.file.mimetype });
  }),
);
