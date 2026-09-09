import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

export const db = new DatabaseSync(config.dbFile);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

/**
 * SQLite-функции lower()/COLLATE NOCASE работают только с ASCII,
 * поэтому регистрируем Unicode-версию для поиска на кириллице.
 */
db.function('ulower', { deterministic: true }, (value) => String(value ?? '').toLowerCase());

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT NOT NULL UNIQUE,
  username       TEXT UNIQUE,
  display_name   TEXT,
  bio            TEXT NOT NULL DEFAULT '',
  avatar_url     TEXT,
  banner_url     TEXT,
  theme          TEXT NOT NULL DEFAULT 'dark',
  role           TEXT NOT NULL DEFAULT 'user',     -- user | admin
  status         TEXT NOT NULL DEFAULT 'active',   -- active | warned | banned
  status_reason  TEXT,
  is_pro         INTEGER NOT NULL DEFAULT 0,
  pro_since      TEXT,
  pro_expires_at TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS otp_codes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  purpose     TEXT NOT NULL DEFAULT 'login',
  attempts    INTEGER NOT NULL DEFAULT 0,
  consumed_at TEXT,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_codes(email, created_at DESC);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_agent TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS posts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title          TEXT NOT NULL DEFAULT '',
  category       TEXT NOT NULL DEFAULT 'other',
  poll_question  TEXT NOT NULL DEFAULT '',
  prompt_text    TEXT NOT NULL,
  model_family   TEXT NOT NULL,
  model_version  TEXT NOT NULL DEFAULT '',
  difficulty     TEXT NOT NULL DEFAULT 'beginner', -- beginner | intermediate | advanced
  description    TEXT NOT NULL DEFAULT '',
  example_text   TEXT NOT NULL DEFAULT '',
  example_image  TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at     TEXT,
  deleted_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  delete_reason  TEXT
);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_model ON posts(model_family);
CREATE INDEX IF NOT EXISTS idx_posts_difficulty ON posts(difficulty);

CREATE TABLE IF NOT EXISTS post_tags (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag     TEXT NOT NULL,
  PRIMARY KEY (post_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_post_tags_tag ON post_tags(tag);

CREATE TABLE IF NOT EXISTS likes (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX IF NOT EXISTS idx_likes_post ON likes(post_id);

CREATE TABLE IF NOT EXISTS reposts (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  comment    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX IF NOT EXISTS idx_reposts_post ON reposts(post_id);
CREATE INDEX IF NOT EXISTS idx_reposts_user ON reposts(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS bookmarks (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS poll_options (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id  INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  text     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_poll_options_post ON poll_options(post_id, position);

CREATE TABLE IF NOT EXISTS poll_votes (
  post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  option_id  INTEGER NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_poll_votes_option ON poll_votes(option_id);

CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id  INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id, created_at);

CREATE TABLE IF NOT EXISTS follows (
  follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (follower_id, followee_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows(followee_id);

CREATE TABLE IF NOT EXISTS reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id      INTEGER REFERENCES posts(id) ON DELETE CASCADE,
  comment_id   INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  reason       TEXT NOT NULL,
  details      TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'open',  -- open | resolved | dismissed
  resolution   TEXT,
  resolved_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  resolved_at  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at DESC);

CREATE TABLE IF NOT EXISTS oauth_accounts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL,   -- github | google | microsoft | discord
  provider_user_id  TEXT NOT NULL,
  email             TEXT,
  display_name      TEXT,
  avatar_url        TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (provider, provider_user_id)
);
CREATE INDEX IF NOT EXISTS idx_oauth_user ON oauth_accounts(user_id);

CREATE TABLE IF NOT EXISTS oauth_states (
  state       TEXT PRIMARY KEY,
  provider    TEXT NOT NULL,
  redirect_to TEXT,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS eduardo_usage (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period     TEXT NOT NULL,   -- 'YYYY-MM', сбрасывается ежемесячно
  text_used  INTEGER NOT NULL DEFAULT 0,
  image_used INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, period)
);

CREATE TABLE IF NOT EXISTS eduardo_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool       TEXT NOT NULL,   -- qa | test | code | image
  prompt     TEXT NOT NULL,
  result     TEXT NOT NULL DEFAULT '',
  image_url  TEXT,
  simulated  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_eduardo_history_user ON eduardo_history(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,   -- report | like | comment | repost | follow | moderation | system
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  link       TEXT,
  actor_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  read_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);
`;

db.exec(SCHEMA);

/**
 * Догоняющие миграции: добавляют колонки в базы, созданные предыдущими
 * версиями схемы. CREATE TABLE IF NOT EXISTS их не добавит.
 */
function addColumnIfMissing(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

addColumnIfMissing('posts', 'title', "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('posts', 'category', "TEXT NOT NULL DEFAULT 'other'");
addColumnIfMissing('posts', 'poll_question', "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('users', 'is_pro', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('users', 'pro_since', 'TEXT');
addColumnIfMissing('users', 'pro_expires_at', 'TEXT');

// Индексы по новым колонкам — только после того, как колонки точно существуют.
db.exec('CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category)');

/* --- Помощники запросов --- */

/**
 * Кэш подготовленных выражений. Лишние именованные параметры разрешены:
 * запросы собираются динамически, и не каждый фильтр попадает в итоговый SQL.
 */
const statementCache = new Map();

function prepare(sql) {
  let statement = statementCache.get(sql);
  if (!statement) {
    statement = db.prepare(sql);
    statement.setAllowUnknownNamedParameters(true);
    statementCache.set(sql, statement);
  }
  return statement;
}

export const all = (sql, params = {}) => prepare(sql).all(params);
export const get = (sql, params = {}) => prepare(sql).get(params) ?? null;
export const run = (sql, params = {}) => prepare(sql).run(params);

/** Выполняет функцию в транзакции. */
export function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function closeDb() {
  statementCache.clear();
  try {
    db.close();
  } catch {
    /* уже закрыта */
  }
}
