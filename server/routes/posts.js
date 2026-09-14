import express from 'express';
import { config } from '../config.js';
import { all, get, run, transaction } from '../db.js';
import { requireAuth } from '../auth.js';
import {
  buildFeedItems,
  commentTree,
  feedPostIds,
  notify,
  notifyAdmins,
  postById,
} from '../store.js';
import {
  CATEGORY_IDS,
  DIFFICULTY_IDS,
  LIMITS,
  MODEL_FAMILY_IDS,
  REPORT_REASONS,
  REPORT_REASON_IDS,
  SORT_IDS,
} from '../constants.js';
import {
  badRequest,
  clampInt,
  createRateLimiter,
  forbidden,
  normalizeTags,
  notFound,
  nowIso,
  text,
  wrap,
} from '../util.js';

export const router = express.Router();

const postLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 20 });
const commentLimiter = createRateLimiter({ windowMs: 5 * 60 * 1000, max: 40 });

function pagination(req) {
  const limit = clampInt(req.query.limit, { min: 1, max: 50, fallback: config.feed.pageSize });
  const page = clampInt(req.query.page, { min: 1, max: 10000, fallback: 1 });
  return { limit, offset: (page - 1) * limit, page };
}

function readPostBody(body) {
  const promptText = text(body?.promptText, {
    max: LIMITS.promptText,
    min: 5,
    field: 'Текст промпта',
    required: true,
  });

  const modelFamily = String(body?.modelFamily ?? '').trim();
  if (!MODEL_FAMILY_IDS.includes(modelFamily)) throw badRequest('Выберите модель ИИ');

  const difficulty = String(body?.difficulty ?? 'beginner').trim();
  if (!DIFFICULTY_IDS.includes(difficulty)) throw badRequest('Выберите уровень сложности');

  const category = String(body?.category ?? 'other').trim();
  if (!CATEGORY_IDS.includes(category)) throw badRequest('Выберите категорию');

  return {
    title: text(body?.title, { max: LIMITS.title, field: 'Заголовок' }),
    category,
    promptText,
    modelFamily,
    modelVersion: text(body?.modelVersion, { max: LIMITS.modelVersion, field: 'Версия модели' }),
    difficulty,
    description: text(body?.description, { max: LIMITS.description, field: 'Описание' }),
    exampleText: text(body?.exampleText, { max: LIMITS.exampleText, field: 'Пример результата' }),
    exampleImage: body?.exampleImage ? String(body.exampleImage).slice(0, 300) : null,
    tags: normalizeTags(body?.tags),
    poll: readPoll(body?.poll),
  };
}

/**
 * Разбирает опрос из тела запроса.
 * Пустой вопрос означает «опроса нет».
 */
function readPoll(poll) {
  const question = text(poll?.question, { max: LIMITS.pollQuestion, field: 'Вопрос опроса' });
  if (!question) return null;

  const options = [];
  for (const raw of Array.isArray(poll?.options) ? poll.options : []) {
    const option = text(raw, { max: LIMITS.pollOption, field: 'Вариант ответа' });
    if (option) options.push(option);
    if (options.length >= LIMITS.pollOptions) break;
  }
  if (options.length < 2) throw badRequest('В опросе нужно минимум два варианта ответа');
  if (new Set(options).size !== options.length) throw badRequest('Варианты ответа не должны повторяться');
  return { question, options };
}

/** Пересоздаёт варианты опроса поста (голоса при этом сбрасываются). */
function savePoll(postId, poll) {
  run('DELETE FROM poll_votes WHERE post_id = $id', { id: postId });
  run('DELETE FROM poll_options WHERE post_id = $id', { id: postId });
  if (!poll) return;
  poll.options.forEach((option, index) => {
    run('INSERT INTO poll_options (post_id, position, text) VALUES ($id, $position, $text)', {
      id: postId,
      position: index,
      text: option,
    });
  });
}

/** GET /api/posts — лента с фильтрами. */
router.get(
  '/',
  wrap(async (req, res) => {
    const { limit, offset, page } = pagination(req);
    const viewerId = req.user?.id ?? 0;
    const tab = ['latest', 'popular', 'following'].includes(req.query.tab) ? req.query.tab : 'latest';
    if (tab === 'following' && !viewerId) throw forbidden('Лента подписок доступна после входа');

    const sort = SORT_IDS.includes(req.query.sort) ? req.query.sort : 'new';

    const rows = feedPostIds({
      tab,
      sort,
      viewerId,
      model: req.query.model || undefined,
      difficulty: req.query.difficulty || undefined,
      category: req.query.category || undefined,
      tag: req.query.tag ? String(req.query.tag).toLowerCase() : undefined,
      q: req.query.q ? String(req.query.q).trim().slice(0, 100) : undefined,
      limit: limit + 1,
      offset,
    });

    const hasMore = rows.length > limit;
    const items = buildFeedItems(rows.slice(0, limit), viewerId);
    res.json({ items, page, limit, hasMore, tab, sort });
  }),
);

/** POST /api/posts — публикация промпта. */
router.post(
  '/',
  requireAuth,
  wrap(async (req, res) => {
    if (!postLimiter(`post:${req.user.id}`).ok) {
      throw badRequest('Слишком много публикаций подряд. Немного подождите.');
    }
    const data = readPostBody(req.body);

    const postId = transaction(() => {
      const result = run(
        `INSERT INTO posts
           (author_id, title, category, poll_question, prompt_text, model_family, model_version,
            difficulty, description, example_text, example_image)
         VALUES ($authorId, $title, $category, $pollQuestion, $promptText, $modelFamily, $modelVersion,
                 $difficulty, $description, $exampleText, $exampleImage)`,
        {
          authorId: req.user.id,
          title: data.title,
          category: data.category,
          pollQuestion: data.poll?.question ?? '',
          promptText: data.promptText,
          modelFamily: data.modelFamily,
          modelVersion: data.modelVersion,
          difficulty: data.difficulty,
          description: data.description,
          exampleText: data.exampleText,
          exampleImage: data.exampleImage,
        },
      );
      const id = Number(result.lastInsertRowid);
      for (const tag of data.tags) {
        run('INSERT OR IGNORE INTO post_tags (post_id, tag) VALUES ($id, $tag)', { id, tag });
      }
      savePoll(id, data.poll);
      return id;
    });

    res.status(201).json({ post: postById(postId, req.user.id) });
  }),
);

/** GET /api/posts/:id */
router.get(
  '/:id',
  wrap(async (req, res) => {
    const post = postById(Number(req.params.id), req.user?.id ?? 0);
    if (!post) throw notFound('Пост не найден или удалён');
    res.json({ post, comments: commentTree(post.id, req.user?.id ?? 0) });
  }),
);

/** PATCH /api/posts/:id — редактирование собственного поста. */
router.patch(
  '/:id',
  requireAuth,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const row = get('SELECT * FROM posts WHERE id = $id AND deleted_at IS NULL', { id });
    if (!row) throw notFound('Пост не найден');
    if (row.author_id !== req.user.id && req.user.role !== 'admin') {
      throw forbidden('Можно редактировать только свои посты');
    }
    // Частичное редактирование: поля, которых нет в теле запроса,
    // берутся из текущего поста — включая теги и опрос, иначе они бы стёрлись.
    const currentTags = all('SELECT tag FROM post_tags WHERE post_id = $id ORDER BY tag', { id }).map(
      (t) => t.tag,
    );
    const currentPoll = row.poll_question
      ? {
          question: row.poll_question,
          options: all('SELECT text FROM poll_options WHERE post_id = $id ORDER BY position', { id }).map(
            (o) => o.text,
          ),
        }
      : null;

    const data = readPostBody({
      title: row.title,
      category: row.category,
      description: row.description,
      exampleText: row.example_text,
      exampleImage: row.example_image,
      modelFamily: row.model_family,
      modelVersion: row.model_version,
      difficulty: row.difficulty,
      tags: currentTags,
      poll: currentPoll,
      ...req.body,
      promptText: req.body?.promptText ?? row.prompt_text,
    });

    transaction(() => {
      run(
        `UPDATE posts SET title = $title, category = $category, poll_question = $pollQuestion,
           prompt_text = $promptText, model_family = $modelFamily,
           model_version = $modelVersion, difficulty = $difficulty, description = $description,
           example_text = $exampleText, example_image = $exampleImage
         WHERE id = $id`,
        { ...data, pollQuestion: data.poll?.question ?? '', id },
      );
      run('DELETE FROM post_tags WHERE post_id = $id', { id });
      for (const tag of data.tags) {
        run('INSERT OR IGNORE INTO post_tags (post_id, tag) VALUES ($id, $tag)', { id, tag });
      }
      // Опрос пересоздаётся, только если он изменился — иначе голоса бы обнулялись.
      const current = all('SELECT text FROM poll_options WHERE post_id = $id ORDER BY position', { id })
        .map((o) => o.text)
        .join('\u0000');
      const next = (data.poll?.options ?? []).join('\u0000');
      if (current !== next) savePoll(id, data.poll);
    });

    res.json({ post: postById(id, req.user.id) });
  }),
);

/** DELETE /api/posts/:id — удаление своего поста (или админом). */
router.delete(
  '/:id',
  requireAuth,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const row = get('SELECT * FROM posts WHERE id = $id AND deleted_at IS NULL', { id });
    if (!row) throw notFound('Пост не найден');
    const isAdmin = req.user.role === 'admin';
    if (row.author_id !== req.user.id && !isAdmin) throw forbidden('Это не ваш пост');

    run(
      `UPDATE posts SET deleted_at = $now, deleted_by = $by, delete_reason = $reason WHERE id = $id`,
      {
        id,
        now: nowIso(),
        by: req.user.id,
        reason: isAdmin && row.author_id !== req.user.id ? 'Удалено модератором' : 'Удалено автором',
      },
    );
    res.json({ ok: true });
  }),
);

/** POST /api/posts/:id/like — поставить/снять лайк. */
router.post(
  '/:id/like',
  requireAuth,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const row = get('SELECT * FROM posts WHERE id = $id AND deleted_at IS NULL', { id });
    if (!row) throw notFound('Пост не найден');

    const existing = get('SELECT 1 AS x FROM likes WHERE user_id = $u AND post_id = $id', {
      u: req.user.id,
      id,
    });
    if (existing) {
      run('DELETE FROM likes WHERE user_id = $u AND post_id = $id', { u: req.user.id, id });
    } else {
      run('INSERT INTO likes (user_id, post_id) VALUES ($u, $id)', { u: req.user.id, id });
      notify({
        userId: row.author_id,
        actorId: req.user.id,
        type: 'like',
        title: `@${req.user.username} лайкнул(а) ваш промпт`,
        body: row.prompt_text.slice(0, 120),
        link: `/post/${id}`,
      });
    }
    const post = postById(id, req.user.id);
    res.json({ liked: post.viewer.liked, counts: post.counts });
  }),
);

/** POST /api/posts/:id/repost — репост/отмена репоста. */
router.post(
  '/:id/repost',
  requireAuth,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const row = get('SELECT * FROM posts WHERE id = $id AND deleted_at IS NULL', { id });
    if (!row) throw notFound('Пост не найден');
    if (row.author_id === req.user.id) throw badRequest('Нельзя репостить собственный пост');

    const existing = get('SELECT 1 AS x FROM reposts WHERE user_id = $u AND post_id = $id', {
      u: req.user.id,
      id,
    });
    if (existing) {
      run('DELETE FROM reposts WHERE user_id = $u AND post_id = $id', { u: req.user.id, id });
    } else {
      run('INSERT INTO reposts (user_id, post_id, comment) VALUES ($u, $id, $c)', {
        u: req.user.id,
        id,
        c: text(req.body?.comment, { max: 280, field: 'Комментарий к репосту' }),
      });
      notify({
        userId: row.author_id,
        actorId: req.user.id,
        type: 'repost',
        title: `@${req.user.username} сделал(а) репост вашего промпта`,
        body: row.prompt_text.slice(0, 120),
        link: `/post/${id}`,
      });
    }
    const post = postById(id, req.user.id);
    res.json({ reposted: post.viewer.reposted, counts: post.counts });
  }),
);

/** GET /api/posts/:id/likes — кто лайкнул. */
router.get(
  '/:id/likes',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const { limit, offset } = pagination(req);
    const { n: total } = get('SELECT COUNT(*) AS n FROM likes WHERE post_id = $id', { id });
    const list = all(
      `SELECT u.id, u.username, u.display_name, u.avatar_url
       FROM likes l JOIN users u ON u.id = l.user_id
       WHERE l.post_id = $id ORDER BY l.created_at DESC LIMIT $limit OFFSET $offset`,
      { id, limit, offset },
    );
    res.json({
      total,
      users: list.map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.display_name || u.username,
        avatarUrl: u.avatar_url || null,
      })),
    });
  }),
);

/** POST /api/posts/:id/bookmark — сохранить пост / убрать из сохранённого. */
router.post(
  '/:id/bookmark',
  requireAuth,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const row = get('SELECT * FROM posts WHERE id = $id AND deleted_at IS NULL', { id });
    if (!row) throw notFound('Пост не найден');

    const existing = get('SELECT 1 AS x FROM bookmarks WHERE user_id = $u AND post_id = $id', {
      u: req.user.id,
      id,
    });
    if (existing) {
      run('DELETE FROM bookmarks WHERE user_id = $u AND post_id = $id', { u: req.user.id, id });
    } else {
      run('INSERT INTO bookmarks (user_id, post_id) VALUES ($u, $id)', { u: req.user.id, id });
    }
    const post = postById(id, req.user.id);
    res.json({ bookmarked: post.viewer.bookmarked, counts: post.counts });
  }),
);

/** POST /api/posts/:id/vote — голос в опросе. Повторный голос переносится. */
router.post(
  '/:id/vote',
  requireAuth,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const row = get('SELECT * FROM posts WHERE id = $id AND deleted_at IS NULL', { id });
    if (!row) throw notFound('Пост не найден');
    if (!row.poll_question) throw badRequest('У этого поста нет опроса');

    const optionId = Number(req.body?.optionId);
    const option = get('SELECT * FROM poll_options WHERE id = $optionId AND post_id = $id', {
      optionId,
      id,
    });
    if (!option) throw badRequest('Такого варианта ответа нет');

    run(
      `INSERT INTO poll_votes (post_id, option_id, user_id) VALUES ($id, $optionId, $u)
       ON CONFLICT(post_id, user_id) DO UPDATE SET option_id = $optionId, created_at = $now`,
      { id, optionId, u: req.user.id, now: nowIso() },
    );

    res.json({ poll: postById(id, req.user.id).poll });
  }),
);

/* ---------------------------- Комментарии --------------------------- */

/** GET /api/posts/:id/comments */
router.get(
  '/:id/comments',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const post = postById(id, req.user?.id ?? 0);
    if (!post) throw notFound('Пост не найден');
    res.json({ comments: commentTree(id, req.user?.id ?? 0) });
  }),
);

/** POST /api/posts/:id/comments — комментарий или ответ в треде. */
router.post(
  '/:id/comments',
  requireAuth,
  wrap(async (req, res) => {
    if (!commentLimiter(`c:${req.user.id}`).ok) throw badRequest('Слишком много комментариев подряд');
    const id = Number(req.params.id);
    const row = get('SELECT * FROM posts WHERE id = $id AND deleted_at IS NULL', { id });
    if (!row) throw notFound('Пост не найден');

    const body = text(req.body?.body, {
      max: LIMITS.comment,
      min: 1,
      field: 'Комментарий',
      required: true,
    });

    let parentId = null;
    if (req.body?.parentId) {
      const parent = get('SELECT * FROM comments WHERE id = $id AND post_id = $postId', {
        id: Number(req.body.parentId),
        postId: id,
      });
      if (!parent) throw badRequest('Комментарий, на который вы отвечаете, не найден');
      parentId = parent.id;
      notify({
        userId: parent.author_id,
        actorId: req.user.id,
        type: 'comment',
        title: `@${req.user.username} ответил(а) на ваш комментарий`,
        body: body.slice(0, 120),
        link: `/post/${id}`,
      });
    }

    run(
      'INSERT INTO comments (post_id, author_id, parent_id, body) VALUES ($postId, $authorId, $parentId, $body)',
      { postId: id, authorId: req.user.id, parentId, body },
    );

    notify({
      userId: row.author_id,
      actorId: req.user.id,
      type: 'comment',
      title: `@${req.user.username} прокомментировал(а) ваш промпт`,
      body: body.slice(0, 120),
      link: `/post/${id}`,
    });

    res.status(201).json({ comments: commentTree(id, req.user.id), counts: postById(id, req.user.id).counts });
  }),
);

/* ------------------------------ Жалобы ------------------------------ */

/** POST /api/posts/:id/report — пожаловаться на пост. */
router.post(
  '/:id/report',
  requireAuth,
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const row = get('SELECT * FROM posts WHERE id = $id AND deleted_at IS NULL', { id });
    if (!row) throw notFound('Пост не найден');
    if (row.author_id === req.user.id) throw badRequest('Нельзя пожаловаться на свой пост');

    const reason = String(req.body?.reason ?? '').trim();
    if (!REPORT_REASON_IDS.includes(reason)) throw badRequest('Выберите причину жалобы');
    const details = text(req.body?.details, { max: LIMITS.reportDetails, field: 'Комментарий' });

    const duplicate = get(
      "SELECT 1 AS x FROM reports WHERE reporter_id = $u AND post_id = $id AND status = 'open'",
      { u: req.user.id, id },
    );
    if (duplicate) throw badRequest('Вы уже отправили жалобу на этот пост', 'duplicate_report');

    run(
      'INSERT INTO reports (reporter_id, post_id, reason, details) VALUES ($u, $id, $reason, $details)',
      { u: req.user.id, id, reason, details },
    );

    const reasonLabel = REPORT_REASONS.find((r) => r.id === reason)?.label ?? reason;
    notifyAdmins({
      actorId: req.user.id,
      type: 'report',
      title: `Новая жалоба: ${reasonLabel}`,
      body: `@${req.user.username} пожаловался(ась) на пост #${id}: ${row.prompt_text.slice(0, 100)}`,
      link: '/admin',
    });

    res.status(201).json({ ok: true });
  }),
);

/* -------------------- Отдельный роутер комментариев ------------------- */

export const commentsRouter = express.Router();

/** DELETE /api/comments/:id — удаление своего комментария. */
commentsRouter.delete(
  '/:commentId',
  requireAuth,
  wrap(async (req, res) => {
    const commentId = Number(req.params.commentId);
    const row = get('SELECT * FROM comments WHERE id = $id AND deleted_at IS NULL', { id: commentId });
    if (!row) throw notFound('Комментарий не найден');
    if (row.author_id !== req.user.id && req.user.role !== 'admin') throw forbidden('Это не ваш комментарий');
    run('UPDATE comments SET deleted_at = $now WHERE id = $id', { id: commentId, now: nowIso() });
    res.json({ ok: true, comments: commentTree(row.post_id, req.user.id) });
  }),
);
