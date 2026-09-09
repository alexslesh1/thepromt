import { all, get, run } from './db.js';

/* ------------------------------------------------------------------ */
/* Пользователи                                                        */
/* ------------------------------------------------------------------ */

export function publicUser(row, viewerId = null) {
  if (!row) return null;
  const counts = get(
    `SELECT
       (SELECT COUNT(*) FROM posts   WHERE author_id = $id AND deleted_at IS NULL) AS posts,
       (SELECT COUNT(*) FROM follows WHERE followee_id = $id)                      AS followers,
       (SELECT COUNT(*) FROM follows WHERE follower_id = $id)                      AS following,
       (SELECT COUNT(*) FROM likes l JOIN posts p ON p.id = l.post_id
          WHERE p.author_id = $id AND p.deleted_at IS NULL)                        AS likes,
       (SELECT COUNT(*) FROM bookmarks b JOIN posts p ON p.id = b.post_id
          WHERE b.user_id = $id AND p.deleted_at IS NULL)                          AS bookmarks`,
    { id: row.id },
  );
  // Число сохранённого — приватная величина, как и сама вкладка «Сохранённое».
  if (viewerId !== row.id) delete counts.bookmarks;

  const isFollowing = viewerId
    ? !!get('SELECT 1 AS x FROM follows WHERE follower_id = $v AND followee_id = $id', {
        v: viewerId,
        id: row.id,
      })
    : false;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name || row.username,
    bio: row.bio || '',
    avatarUrl: row.avatar_url || null,
    bannerUrl: row.banner_url || null,
    role: row.role,
    status: row.status,
    statusReason: row.status_reason || null,
    createdAt: row.created_at,
    counts,
    isFollowing,
    isMe: viewerId === row.id,
  };
}

/** Расширенное представление — только для самого пользователя. */
export function privateUser(row) {
  if (!row) return null;
  return {
    ...publicUser(row, row.id),
    email: row.email,
    theme: row.theme,
    needsProfile: !row.username,
    unreadNotifications: countUnreadNotifications(row.id),
    unreadMessages: countUnreadMessages(row.id),
    openReports: row.role === 'admin' ? countOpenReports() : 0,
  };
}

export const userById = (id) => get('SELECT * FROM users WHERE id = $id', { id });
export const userByEmail = (email) => get('SELECT * FROM users WHERE email = $email', { email });
export const userByUsername = (username) =>
  get('SELECT * FROM users WHERE ulower(username) = ulower($username)', { username });

/* ------------------------------------------------------------------ */
/* Посты                                                               */
/* ------------------------------------------------------------------ */

const POST_SELECT = `
  SELECT p.*,
         u.username, u.display_name, u.avatar_url, u.role AS author_role, u.status AS author_status,
         (SELECT COUNT(*) FROM likes    l WHERE l.post_id = p.id)                          AS like_count,
         (SELECT COUNT(*) FROM reposts  r WHERE r.post_id = p.id)                          AS repost_count,
         (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.deleted_at IS NULL) AS comment_count,
         (SELECT COUNT(*) FROM bookmarks b WHERE b.post_id = p.id)                          AS bookmark_count,
         EXISTS(SELECT 1 FROM likes     l WHERE l.post_id = p.id AND l.user_id = $viewer)  AS liked,
         EXISTS(SELECT 1 FROM reposts   r WHERE r.post_id = p.id AND r.user_id = $viewer)  AS reposted,
         EXISTS(SELECT 1 FROM bookmarks b WHERE b.post_id = p.id AND b.user_id = $viewer)  AS bookmarked
  FROM posts p
  JOIN users u ON u.id = p.author_id
`;

function tagsForPosts(ids) {
  const map = new Map(ids.map((id) => [id, []]));
  if (!ids.length) return map;
  const list = ids.map((id) => Number(id)).join(',');
  for (const row of all(`SELECT post_id, tag FROM post_tags WHERE post_id IN (${list}) ORDER BY tag`)) {
    map.get(row.post_id)?.push(row.tag);
  }
  return map;
}

function shapePost(row, tags = [], poll = null) {
  return {
    id: row.id,
    title: row.title || '',
    category: row.category || 'other',
    promptText: row.prompt_text,
    modelFamily: row.model_family,
    modelVersion: row.model_version || '',
    difficulty: row.difficulty,
    description: row.description || '',
    exampleText: row.example_text || '',
    exampleImage: row.example_image || null,
    createdAt: row.created_at,
    deleted: !!row.deleted_at,
    deleteReason: row.delete_reason || null,
    tags,
    poll,
    author: {
      id: row.author_id,
      username: row.username,
      displayName: row.display_name || row.username,
      avatarUrl: row.avatar_url || null,
      role: row.author_role,
      status: row.author_status,
    },
    counts: {
      likes: row.like_count,
      reposts: row.repost_count,
      comments: row.comment_count,
      bookmarks: row.bookmark_count,
    },
    viewer: {
      liked: !!row.liked,
      reposted: !!row.reposted,
      bookmarked: !!row.bookmarked,
    },
  };
}

/**
 * Собирает опросы для списка постов: варианты, число голосов и выбор зрителя.
 * Возвращает Map postId → poll | null.
 */
function pollsForPosts(rows, viewerId = 0) {
  const map = new Map(rows.map((r) => [r.id, null]));
  const withPoll = rows.filter((r) => r.poll_question);
  if (!withPoll.length) return map;

  const list = withPoll.map((r) => Number(r.id)).join(',');
  const options = all(
    `SELECT o.id, o.post_id, o.position, o.text,
            (SELECT COUNT(*) FROM poll_votes v WHERE v.option_id = o.id) AS votes
     FROM poll_options o
     WHERE o.post_id IN (${list})
     ORDER BY o.post_id, o.position`,
  );
  const myVotes = new Map(
    viewerId
      ? all(
          `SELECT post_id, option_id FROM poll_votes
           WHERE user_id = $viewer AND post_id IN (${list})`,
          { viewer: viewerId },
        ).map((v) => [v.post_id, v.option_id])
      : [],
  );

  for (const row of withPoll) {
    const own = options.filter((o) => o.post_id === row.id);
    map.set(row.id, {
      question: row.poll_question,
      totalVotes: own.reduce((sum, o) => sum + o.votes, 0),
      votedOptionId: myVotes.get(row.id) ?? null,
      options: own.map((o) => ({ id: o.id, text: o.text, votes: o.votes })),
    });
  }
  return map;
}

/** Достаёт посты по списку id, сохраняя порядок ids. */
export function hydratePosts(ids, viewerId = 0, { includeDeleted = false } = {}) {
  if (!ids.length) return [];
  const list = ids.map((id) => Number(id)).join(',');
  const rows = all(
    `${POST_SELECT} WHERE p.id IN (${list}) ${includeDeleted ? '' : 'AND p.deleted_at IS NULL'}`,
    { viewer: viewerId || 0 },
  );
  const tags = tagsForPosts(rows.map((r) => r.id));
  const polls = pollsForPosts(rows, viewerId);
  const byId = new Map(
    rows.map((r) => [r.id, shapePost(r, tags.get(r.id) ?? [], polls.get(r.id) ?? null)]),
  );
  return ids.map((id) => byId.get(Number(id))).filter(Boolean);
}

export function postById(id, viewerId = 0, { includeDeleted = false } = {}) {
  const row = get(
    `${POST_SELECT} WHERE p.id = $id ${includeDeleted ? '' : 'AND p.deleted_at IS NULL'}`,
    { id, viewer: viewerId || 0 },
  );
  if (!row) return null;
  return shapePost(row, tagsForPosts([row.id]).get(row.id) ?? [], pollsForPosts([row], viewerId).get(row.id) ?? null);
}

/**
 * Лента постов с фильтрами и сортировкой.
 * tab: latest | popular | following
 */
export function feedPostIds({
  tab = 'latest',
  sort = 'new',
  viewerId = 0,
  model,
  difficulty,
  category,
  tag,
  q,
  authorId,
  limit,
  offset,
}) {
  const where = ['p.deleted_at IS NULL'];
  const params = { limit, offset, viewer: viewerId || 0 };

  if (model) {
    where.push('p.model_family = $model');
    params.model = model;
  }
  if (difficulty) {
    where.push('p.difficulty = $difficulty');
    params.difficulty = difficulty;
  }
  if (category) {
    where.push('p.category = $category');
    params.category = category;
  }
  if (tag) {
    where.push('EXISTS(SELECT 1 FROM post_tags t WHERE t.post_id = p.id AND t.tag = $tag)');
    params.tag = tag;
  }
  if (authorId) {
    where.push('p.author_id = $authorId');
    params.authorId = authorId;
  }
  if (q) {
    where.push(`(
      ulower(p.prompt_text)   LIKE $q OR
      ulower(p.description)   LIKE $q OR
      ulower(p.model_version) LIKE $q OR
      ulower(p.model_family)  LIKE $q OR
      ulower(u.username)      LIKE $q OR
      ulower(u.display_name)  LIKE $q OR
      EXISTS(SELECT 1 FROM post_tags t WHERE t.post_id = p.id AND ulower(t.tag) LIKE $q)
    )`);
    params.q = `%${q.toLowerCase()}%`;
  }

  if (tab === 'following') {
    if (!viewerId) return [];
    // Посты авторов, на которых подписан пользователь, плюс их репосты.
    params.follower = viewerId;
    const rows = all(
      `SELECT post_id, sort_at, reposter_id FROM (
         SELECT p.id AS post_id, p.created_at AS sort_at, NULL AS reposter_id
         FROM posts p JOIN users u ON u.id = p.author_id
         WHERE ${where.join(' AND ')}
           AND p.author_id IN (SELECT followee_id FROM follows WHERE follower_id = $follower)
         UNION ALL
         SELECT r.post_id AS post_id, r.created_at AS sort_at, r.user_id AS reposter_id
         FROM reposts r
         JOIN posts p ON p.id = r.post_id
         JOIN users u ON u.id = p.author_id
         WHERE ${where.join(' AND ')}
           AND r.user_id IN (SELECT followee_id FROM follows WHERE follower_id = $follower)
       )
       ORDER BY sort_at DESC, post_id DESC
       LIMIT $limit OFFSET $offset`,
      params,
    );
    return rows;
  }

  // Вкладка «Популярное» задаёт сортировку сама; на остальных её выбирает
  // пользователь в селекторе «Сначала свежее».
  const effectiveSort = tab === 'popular' ? 'popular' : sort;
  const ORDERS = {
    new: 'p.created_at DESC, p.id DESC',
    popular: `((SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) * 3
        + (SELECT COUNT(*) FROM reposts r WHERE r.post_id = p.id) * 2
        + (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.deleted_at IS NULL) * 2
        + (SELECT COUNT(*) FROM bookmarks b WHERE b.post_id = p.id) * 2) DESC,
       p.created_at DESC`,
    discussed: `(SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.deleted_at IS NULL) DESC,
       p.created_at DESC`,
  };
  const order = ORDERS[effectiveSort] ?? ORDERS.new;

  return all(
    `SELECT p.id AS post_id, p.created_at AS sort_at, NULL AS reposter_id
     FROM posts p JOIN users u ON u.id = p.author_id
     WHERE ${where.join(' AND ')}
     ORDER BY ${order}
     LIMIT $limit OFFSET $offset`,
    params,
  );
}

/** Лента профиля: собственные посты + репосты пользователя в хронологии. */
export function profileFeedRows(userId, { limit, offset }) {
  return all(
    `SELECT post_id, sort_at, reposter_id FROM (
       SELECT p.id AS post_id, p.created_at AS sort_at, NULL AS reposter_id
       FROM posts p WHERE p.author_id = $userId AND p.deleted_at IS NULL
       UNION ALL
       SELECT r.post_id, r.created_at, r.user_id
       FROM reposts r JOIN posts p ON p.id = r.post_id
       WHERE r.user_id = $userId AND p.deleted_at IS NULL
     )
     ORDER BY sort_at DESC, post_id DESC
     LIMIT $limit OFFSET $offset`,
    { userId, limit, offset },
  );
}

export function likedPostRows(userId, { limit, offset }) {
  return all(
    `SELECT l.post_id AS post_id, l.created_at AS sort_at, NULL AS reposter_id
     FROM likes l JOIN posts p ON p.id = l.post_id
     WHERE l.user_id = $userId AND p.deleted_at IS NULL
     ORDER BY l.created_at DESC
     LIMIT $limit OFFSET $offset`,
    { userId, limit, offset },
  );
}

export function bookmarkedPostRows(userId, { limit, offset }) {
  return all(
    `SELECT b.post_id AS post_id, b.created_at AS sort_at, NULL AS reposter_id
     FROM bookmarks b JOIN posts p ON p.id = b.post_id
     WHERE b.user_id = $userId AND p.deleted_at IS NULL
     ORDER BY b.created_at DESC
     LIMIT $limit OFFSET $offset`,
    { userId, limit, offset },
  );
}

/** Превращает строки ленты в элементы с пометкой о репосте. */
export function buildFeedItems(rows, viewerId) {
  const posts = hydratePosts(rows.map((r) => r.post_id), viewerId);
  const byId = new Map(posts.map((p) => [p.id, p]));
  const reposterIds = [...new Set(rows.map((r) => r.reposter_id).filter(Boolean))];
  const reposters = new Map();
  if (reposterIds.length) {
    for (const row of all(
      `SELECT id, username, display_name, avatar_url FROM users WHERE id IN (${reposterIds.join(',')})`,
    )) {
      reposters.set(row.id, {
        id: row.id,
        username: row.username,
        displayName: row.display_name || row.username,
        avatarUrl: row.avatar_url || null,
      });
    }
  }
  const items = [];
  const seen = new Set();
  for (const row of rows) {
    const post = byId.get(row.post_id);
    if (!post) continue;
    const key = `${row.reposter_id ?? 0}:${row.post_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      type: row.reposter_id ? 'repost' : 'post',
      sortAt: row.sort_at,
      repostedBy: row.reposter_id ? reposters.get(row.reposter_id) ?? null : null,
      post,
    });
  }
  return items;
}

/* ------------------------------------------------------------------ */
/* Комментарии                                                         */
/* ------------------------------------------------------------------ */

export function commentTree(postId, viewerId = 0) {
  const rows = all(
    `SELECT c.*, u.username, u.display_name, u.avatar_url, u.role
     FROM comments c JOIN users u ON u.id = c.author_id
     WHERE c.post_id = $postId
     ORDER BY c.created_at ASC, c.id ASC`,
    { postId },
  );
  const shape = (row) => ({
    id: row.id,
    postId: row.post_id,
    parentId: row.parent_id,
    body: row.deleted_at ? '[комментарий удалён]' : row.body,
    deleted: !!row.deleted_at,
    createdAt: row.created_at,
    canDelete: viewerId ? row.author_id === viewerId : false,
    author: {
      id: row.author_id,
      username: row.username,
      displayName: row.display_name || row.username,
      avatarUrl: row.avatar_url || null,
      role: row.role,
    },
    replies: [],
  });
  const byId = new Map();
  const roots = [];
  for (const row of rows) {
    const node = shape(row);
    byId.set(node.id, node);
  }
  for (const row of rows) {
    const node = byId.get(row.id);
    const parent = row.parent_id ? byId.get(row.parent_id) : null;
    if (parent) parent.replies.push(node);
    else roots.push(node);
  }
  return roots;
}

/* ------------------------------------------------------------------ */
/* Уведомления                                                         */
/* ------------------------------------------------------------------ */

export function notify({ userId, type, title, body = '', link = null, actorId = null }) {
  if (!userId || userId === actorId) return; // себе не уведомляем
  run(
    `INSERT INTO notifications (user_id, type, title, body, link, actor_id)
     VALUES ($userId, $type, $title, $body, $link, $actorId)`,
    { userId, type, title, body, link, actorId },
  );
}

export function notifyAdmins(payload) {
  for (const admin of all("SELECT id FROM users WHERE role = 'admin'")) {
    notify({ ...payload, userId: admin.id });
  }
}

export const countUnreadNotifications = (userId) =>
  get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = $userId AND read_at IS NULL', {
    userId,
  }).n;

/** Непрочитанные во внутренней переписке — бейдж пункта «Сообщения». */
export const countUnreadMessages = (userId) =>
  get(
    `SELECT COUNT(*) AS n FROM notifications
     WHERE user_id = $userId AND read_at IS NULL
       AND type IN (${MESSAGE_TYPES.map((t) => `'${t}'`).join(', ')})`,
    { userId },
  ).n;

export const countOpenReports = () =>
  get("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'").n;

/** Типы, которые показываются в разделе «Сообщения» (внутренняя переписка). */
export const MESSAGE_TYPES = ['moderation', 'report', 'system'];

export function listNotifications(userId, { limit, offset, kind = 'all' }) {
  const quoted = MESSAGE_TYPES.map((t) => `'${t}'`).join(', ');
  const filter =
    kind === 'messages'
      ? `AND n.type IN (${quoted})`
      : kind === 'activity'
        ? `AND n.type NOT IN (${quoted})`
        : '';

  return all(
    `SELECT n.*, u.username AS actor_username, u.display_name AS actor_name, u.avatar_url AS actor_avatar
     FROM notifications n
     LEFT JOIN users u ON u.id = n.actor_id
     WHERE n.user_id = $userId ${filter}
     ORDER BY n.created_at DESC, n.id DESC
     LIMIT $limit OFFSET $offset`,
    { userId, limit, offset },
  ).map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    link: row.link,
    read: !!row.read_at,
    createdAt: row.created_at,
    actor: row.actor_id
      ? {
          id: row.actor_id,
          username: row.actor_username,
          displayName: row.actor_name || row.actor_username,
          avatarUrl: row.actor_avatar || null,
        }
      : null,
  }));
}

/* ------------------------------------------------------------------ */
/* Разное                                                              */
/* ------------------------------------------------------------------ */

export function trendingTags(limit = 10) {
  return all(
    `SELECT t.tag, COUNT(*) AS n
     FROM post_tags t JOIN posts p ON p.id = t.post_id
     WHERE p.deleted_at IS NULL
     GROUP BY t.tag ORDER BY n DESC, t.tag ASC LIMIT $limit`,
    { limit },
  ).map((r) => ({ tag: r.tag, count: r.n }));
}

export function topModels(limit = 6) {
  return all(
    `SELECT model_family AS id, COUNT(*) AS n FROM posts
     WHERE deleted_at IS NULL GROUP BY model_family ORDER BY n DESC LIMIT $limit`,
    { limit },
  ).map((r) => ({ id: r.id, count: r.n }));
}

export function topCategories(limit = 6) {
  return all(
    `SELECT category AS id, COUNT(*) AS n FROM posts
     WHERE deleted_at IS NULL GROUP BY category ORDER BY n DESC LIMIT $limit`,
    { limit },
  ).map((r) => ({ id: r.id, count: r.n }));
}

export function suggestedUsers(viewerId, limit = 3) {
  return all(
    `SELECT u.*, (SELECT COUNT(*) FROM posts p WHERE p.author_id = u.id AND p.deleted_at IS NULL) AS n
     FROM users u
     WHERE u.username IS NOT NULL
       AND u.status != 'banned'
       AND u.id != $viewer
       AND u.id NOT IN (SELECT followee_id FROM follows WHERE follower_id = $viewer)
     ORDER BY n DESC, u.created_at DESC
     LIMIT $limit`,
    { viewer: viewerId || 0, limit },
  ).map((row) => publicUser(row, viewerId));
}

export function searchUsers(q, viewerId, limit = 10) {
  return all(
    `SELECT * FROM users
     WHERE username IS NOT NULL AND status != 'banned'
       AND (ulower(username) LIKE $q OR ulower(display_name) LIKE $q)
     ORDER BY username LIMIT $limit`,
    { q: `%${q.toLowerCase()}%`, limit },
  ).map((row) => publicUser(row, viewerId));
}
