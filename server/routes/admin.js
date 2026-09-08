import express from 'express';
import { config } from '../config.js';
import { all, get, run } from '../db.js';
import { requireAdmin } from '../auth.js';
import { notify, postById, publicUser, userById } from '../store.js';
import { REPORT_REASONS } from '../constants.js';
import { badRequest, clampInt, forbidden, notFound, nowIso, text, wrap } from '../util.js';

export const router = express.Router();

router.use(requireAdmin);

const reasonLabel = (id) => REPORT_REASONS.find((r) => r.id === id)?.label ?? id;

/** GET /api/admin/stats — сводка для дашборда. */
router.get(
  '/stats',
  wrap(async (_req, res) => {
    const stats = get(`
      SELECT
        (SELECT COUNT(*) FROM users)                                   AS users,
        (SELECT COUNT(*) FROM users WHERE status = 'banned')           AS banned,
        (SELECT COUNT(*) FROM posts WHERE deleted_at IS NULL)          AS posts,
        (SELECT COUNT(*) FROM posts WHERE deleted_at IS NOT NULL)      AS deletedPosts,
        (SELECT COUNT(*) FROM comments WHERE deleted_at IS NULL)       AS comments,
        (SELECT COUNT(*) FROM reports WHERE status = 'open')           AS openReports,
        (SELECT COUNT(*) FROM reports)                                 AS totalReports
    `);
    res.json({ stats });
  }),
);

/** GET /api/admin/reports?status=open|resolved|dismissed|all */
router.get(
  '/reports',
  wrap(async (req, res) => {
    const status = ['open', 'resolved', 'dismissed', 'all'].includes(req.query.status)
      ? req.query.status
      : 'open';
    const limit = clampInt(req.query.limit, { min: 1, max: 100, fallback: 25 });
    const page = clampInt(req.query.page, { min: 1, max: 1000, fallback: 1 });

    const where = status === 'all' ? '1 = 1' : 'r.status = $status';
    const rows = all(
      `SELECT r.*,
              reporter.username AS reporter_username, reporter.display_name AS reporter_name,
              reporter.avatar_url AS reporter_avatar,
              p.author_id AS post_author_id, p.prompt_text, p.deleted_at AS post_deleted_at,
              author.username AS author_username, author.display_name AS author_name,
              author.status AS author_status
       FROM reports r
       JOIN users reporter ON reporter.id = r.reporter_id
       LEFT JOIN posts p ON p.id = r.post_id
       LEFT JOIN users author ON author.id = p.author_id
       WHERE ${where}
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT $limit OFFSET $offset`,
      status === 'all'
        ? { limit: limit + 1, offset: (page - 1) * limit }
        : { status, limit: limit + 1, offset: (page - 1) * limit },
    );

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((row) => ({
      id: row.id,
      reason: row.reason,
      reasonLabel: reasonLabel(row.reason),
      details: row.details,
      status: row.status,
      resolution: row.resolution,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
      reporter: {
        id: row.reporter_id,
        username: row.reporter_username,
        displayName: row.reporter_name || row.reporter_username,
        avatarUrl: row.reporter_avatar || null,
      },
      post: row.post_id
        ? {
            id: row.post_id,
            promptText: row.prompt_text,
            deleted: !!row.post_deleted_at,
            author: {
              id: row.post_author_id,
              username: row.author_username,
              displayName: row.author_name || row.author_username,
              status: row.author_status,
            },
          }
        : null,
    }));

    res.json({ items, page, hasMore, status });
  }),
);

/** GET /api/admin/reports/:id — карточка жалобы с полным постом. */
router.get(
  '/reports/:id',
  wrap(async (req, res) => {
    const row = get('SELECT * FROM reports WHERE id = $id', { id: Number(req.params.id) });
    if (!row) throw notFound('Жалоба не найдена');
    const post = row.post_id ? postById(row.post_id, req.user.id, { includeDeleted: true }) : null;
    const otherReports = all(
      `SELECT r.*, u.username FROM reports r JOIN users u ON u.id = r.reporter_id
       WHERE r.post_id = $postId AND r.id != $id ORDER BY r.created_at DESC`,
      { postId: row.post_id ?? 0, id: row.id },
    ).map((r) => ({
      id: r.id,
      reason: r.reason,
      reasonLabel: reasonLabel(r.reason),
      details: r.details,
      status: r.status,
      createdAt: r.created_at,
      reporter: r.username,
    }));
    res.json({
      report: {
        id: row.id,
        reason: row.reason,
        reasonLabel: reasonLabel(row.reason),
        details: row.details,
        status: row.status,
        resolution: row.resolution,
        createdAt: row.created_at,
        reporter: publicUser(userById(row.reporter_id), req.user.id),
      },
      post,
      author: post ? publicUser(userById(post.author.id), req.user.id) : null,
      otherReports,
    });
  }),
);

/** POST /api/admin/reports/:id/dismiss — отклонить жалобу как необоснованную. */
router.post(
  '/reports/:id/dismiss',
  wrap(async (req, res) => {
    const row = get('SELECT * FROM reports WHERE id = $id', { id: Number(req.params.id) });
    if (!row) throw notFound('Жалоба не найдена');
    if (row.status !== 'open') throw badRequest('Жалоба уже обработана');

    const note = text(req.body?.note, { max: 300, field: 'Комментарий' });
    run(
      `UPDATE reports SET status = 'dismissed', resolution = $note, resolved_by = $by, resolved_at = $now
       WHERE id = $id`,
      { id: row.id, note: note || 'Жалоба признана необоснованной', by: req.user.id, now: nowIso() },
    );

    notify({
      userId: row.reporter_id,
      actorId: req.user.id,
      type: 'moderation',
      title: 'Ваша жалоба отклонена',
      body: note || 'Модератор не нашёл нарушений в этой публикации.',
      link: row.post_id ? `/post/${row.post_id}` : null,
    });

    res.json({ ok: true });
  }),
);

/** POST /api/admin/posts/:id/delete — удалить пост по жалобе. */
router.post(
  '/posts/:id/delete',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const post = get('SELECT * FROM posts WHERE id = $id', { id });
    if (!post) throw notFound('Пост не найден');
    const reason = text(req.body?.reason, { max: 300, field: 'Причина' }) || 'Нарушение правил сообщества';

    if (!post.deleted_at) {
      run(
        'UPDATE posts SET deleted_at = $now, deleted_by = $by, delete_reason = $reason WHERE id = $id',
        { id, now: nowIso(), by: req.user.id, reason },
      );
    }

    run(
      `UPDATE reports SET status = 'resolved', resolution = $reason, resolved_by = $by, resolved_at = $now
       WHERE post_id = $id AND status = 'open'`,
      { id, reason: `Пост удалён: ${reason}`, by: req.user.id, now: nowIso() },
    );

    notify({
      userId: post.author_id,
      actorId: req.user.id,
      type: 'moderation',
      title: 'Ваш пост удалён модератором',
      body: reason,
      link: '/notifications',
    });

    res.json({ ok: true });
  }),
);

/** POST /api/admin/posts/:id/restore — вернуть ошибочно удалённый пост. */
router.post(
  '/posts/:id/restore',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const post = get('SELECT * FROM posts WHERE id = $id', { id });
    if (!post) throw notFound('Пост не найден');
    run('UPDATE posts SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL WHERE id = $id', { id });
    notify({
      userId: post.author_id,
      actorId: req.user.id,
      type: 'moderation',
      title: 'Ваш пост восстановлен',
      link: `/post/${id}`,
    });
    res.json({ ok: true });
  }),
);

/** POST /api/admin/users/:id/moderate — предупреждение, блокировка, разблокировка. */
router.post(
  '/users/:id/moderate',
  wrap(async (req, res) => {
    const id = Number(req.params.id);
    const target = userById(id);
    if (!target) throw notFound('Пользователь не найден');
    if (target.id === req.user.id) throw badRequest('Нельзя модерировать самого себя');
    if (target.role === 'admin') throw forbidden('Нельзя модерировать администратора');

    const action = String(req.body?.action ?? '').trim();
    const reason = text(req.body?.reason, { max: 300, field: 'Причина' });
    const reportId = req.body?.reportId ? Number(req.body.reportId) : null;

    if (!['warn', 'ban', 'unban'].includes(action)) throw badRequest('Неизвестное действие');

    if (action === 'warn') {
      run("UPDATE users SET status = 'warned', status_reason = $reason WHERE id = $id", {
        id,
        reason: reason || 'Предупреждение за нарушение правил',
      });
      notify({
        userId: id,
        actorId: req.user.id,
        type: 'moderation',
        title: 'Предупреждение от модератора',
        body: reason || 'Пожалуйста, соблюдайте правила сообщества.',
        link: '/notifications',
      });
    } else if (action === 'ban') {
      run("UPDATE users SET status = 'banned', status_reason = $reason WHERE id = $id", {
        id,
        reason: reason || 'Блокировка за нарушение правил',
      });
      run('DELETE FROM sessions WHERE user_id = $id', { id });
      notify({
        userId: id,
        actorId: req.user.id,
        type: 'moderation',
        title: 'Ваш аккаунт заблокирован',
        body: reason || 'Блокировка за нарушение правил сообщества.',
      });
    } else {
      run("UPDATE users SET status = 'active', status_reason = NULL WHERE id = $id", { id });
      notify({
        userId: id,
        actorId: req.user.id,
        type: 'moderation',
        title: 'Блокировка снята',
        body: 'Ваш аккаунт снова активен.',
      });
    }

    if (reportId) {
      run(
        `UPDATE reports SET status = 'resolved', resolution = $res, resolved_by = $by, resolved_at = $now
         WHERE id = $reportId AND status = 'open'`,
        {
          reportId,
          res: `Меры к автору: ${action}`,
          by: req.user.id,
          now: nowIso(),
        },
      );
    }

    res.json({ user: publicUser(userById(id), req.user.id) });
  }),
);

/** GET /api/admin/users — список пользователей с поиском. */
router.get(
  '/users',
  wrap(async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    const limit = clampInt(req.query.limit, { min: 1, max: 100, fallback: config.feed.pageSize });
    const page = clampInt(req.query.page, { min: 1, max: 1000, fallback: 1 });
    const rows = all(
      `SELECT * FROM users
       WHERE ($q = '' OR ulower(username) LIKE $like OR ulower(email) LIKE $like
              OR ulower(display_name) LIKE $like)
       ORDER BY created_at DESC LIMIT $limit OFFSET $offset`,
      { q, like: `%${q.toLowerCase()}%`, limit: limit + 1, offset: (page - 1) * limit },
    );
    const hasMore = rows.length > limit;
    res.json({
      items: rows.slice(0, limit).map((row) => ({
        ...publicUser(row, req.user.id),
        email: row.email,
      })),
      page,
      hasMore,
    });
  }),
);
