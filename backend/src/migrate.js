import { pool } from './db.js';

// Idempotent schema. Runs automatically on every server start.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id              SERIAL PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'manager' CHECK (role IN ('admin','manager','viewer')),
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  token_version   INTEGER NOT NULL DEFAULT 0,
  failed_logins   INTEGER NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accounts (
  id                  SERIAL PRIMARY KEY,
  brand               TEXT NOT NULL,
  username            TEXT NOT NULL,
  platform            TEXT NOT NULL DEFAULT 'instagram',
  profile_url         TEXT,
  content_theme       TEXT,
  youtube_status      TEXT DEFAULT 'Not noted',
  two_factor_enabled  BOOLEAN NOT NULL DEFAULT FALSE,
  login_email_enc     TEXT,            -- AES-256-GCM encrypted
  private_notes_enc   TEXT,            -- AES-256-GCM encrypted
  baseline_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  baseline_posts      INTEGER NOT NULL DEFAULT 0,
  baseline_followers  INTEGER NOT NULL DEFAULT 0,
  baseline_following  INTEGER NOT NULL DEFAULT 0,
  color               TEXT,
  archived            BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (platform, username)
);

CREATE TABLE IF NOT EXISTS snapshots (
  id              SERIAL PRIMARY KEY,
  account_id      INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date            DATE NOT NULL,
  followers       INTEGER,
  following       INTEGER,
  posts           INTEGER,
  likes           INTEGER,
  comments        INTEGER,
  shares          INTEGER,
  reach           INTEGER,
  impressions     INTEGER,
  profile_visits  INTEGER,
  dms_received    INTEGER,
  dms_answered    INTEGER,
  notes           TEXT,
  updated_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, date)
);
CREATE INDEX IF NOT EXISTS snapshots_date_idx ON snapshots(date);

CREATE TABLE IF NOT EXISTS checklist_tasks (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  scope       TEXT,
  frequency   TEXT NOT NULL CHECK (frequency IN ('daily','weekly','monthly')),
  position    INTEGER NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS checklist_completions (
  task_id     INTEGER NOT NULL REFERENCES checklist_tasks(id) ON DELETE CASCADE,
  period_key  TEXT NOT NULL,          -- YYYY-MM-DD | YYYY-Www | YYYY-MM
  done_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  done_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, period_key)
);

CREATE TABLE IF NOT EXISTS metrics (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  category     TEXT NOT NULL DEFAULT 'Business',
  unit         TEXT,
  aggregation  TEXT NOT NULL DEFAULT 'sum' CHECK (aggregation IN ('sum','last','avg')),
  higher_is_better BOOLEAN NOT NULL DEFAULT TRUE,
  position     INTEGER NOT NULL DEFAULT 0,
  active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS metric_entries (
  id          SERIAL PRIMARY KEY,
  metric_id   INTEGER NOT NULL REFERENCES metrics(id) ON DELETE CASCADE,
  date        DATE NOT NULL,
  value       NUMERIC NOT NULL,
  note        TEXT,
  updated_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (metric_id, date)
);

CREATE TABLE IF NOT EXISTS metric_targets (
  metric_id  INTEGER NOT NULL REFERENCES metrics(id) ON DELETE CASCADE,
  month      TEXT NOT NULL,           -- YYYY-MM
  target     NUMERIC,
  comment    TEXT,
  PRIMARY KEY (metric_id, month)
);

CREATE TABLE IF NOT EXISTS account_reviews (
  account_id   INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  month        TEXT NOT NULL,
  best_post    TEXT,
  why_worked   TEXT,
  weakest      TEXT,
  fix_next     TEXT,
  rating       INTEGER CHECK (rating BETWEEN 1 AND 5),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, month)
);

CREATE TABLE IF NOT EXISTS monthly_summaries (
  month        TEXT PRIMARY KEY,
  what_worked  TEXT,
  what_didnt   TEXT,
  what_change  TEXT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS action_items (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  account_id  INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  owner       TEXT,
  deadline    DATE,
  done        BOOLEAN NOT NULL DEFAULT FALSE,
  month       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS files (
  id           SERIAL PRIMARY KEY,
  storage_key  TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  mime         TEXT NOT NULL,
  size         INTEGER NOT NULL,
  category     TEXT NOT NULL DEFAULT 'other',
  account_id   INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  note         TEXT,
  uploaded_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reports (
  id           SERIAL PRIMARY KEY,
  title        TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('weekly','monthly','custom')),
  start_date   DATE NOT NULL,
  end_date     DATE NOT NULL,
  data         JSONB NOT NULL,
  storage_key  TEXT,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  entity      TEXT,
  entity_id   TEXT,
  detail      JSONB,
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_created_idx ON audit_log(created_at DESC);

CREATE TABLE IF NOT EXISTS backups (
  id           SERIAL PRIMARY KEY,
  storage_key  TEXT NOT NULL,
  size         INTEGER NOT NULL,
  trigger      TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

// v2 — product workspaces, content tasks, posts, chat, notifications, API sync
const SCHEMA_V2 = `
CREATE TABLE IF NOT EXISTS products (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  tagline      TEXT,
  description  TEXT,
  website_url  TEXT,
  image_key    TEXT,
  color        TEXT,
  archived     BOOLEAN NOT NULL DEFAULT FALSE,
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_members (
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, user_id)
);

ALTER TABLE users     ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE accounts  ADD COLUMN IF NOT EXISTS product_id INTEGER REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE accounts  ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE accounts  ADD COLUMN IF NOT EXISTS api_token_enc TEXT;
ALTER TABLE accounts  ADD COLUMN IF NOT EXISTS sync_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE accounts  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;
ALTER TABLE accounts  ADD COLUMN IF NOT EXISTS sync_error TEXT;
ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS extra JSONB;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS product_id INTEGER;
CREATE INDEX IF NOT EXISTS audit_product_idx ON audit_log(product_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tasks (
  id            SERIAL PRIMARY KEY,
  product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  caption       TEXT,
  hashtags      TEXT,
  instructions  TEXT,
  platforms     TEXT[] NOT NULL DEFAULT '{}',
  priority      TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  due_date      DATE,
  status        TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','done','cancelled')),
  assigned_to   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  completed_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  completed_at  TIMESTAMPTZ,
  completion_note TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tasks_product_idx ON tasks(product_id, status);
CREATE INDEX IF NOT EXISTS tasks_assignee_idx ON tasks(assigned_to, status);

ALTER TABLE files ADD COLUMN IF NOT EXISTS product_id INTEGER REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE files ADD COLUMN IF NOT EXISTS task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS posts (
  id          SERIAL PRIMARY KEY,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  task_id     INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  account_id  INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  platform    TEXT NOT NULL,
  url         TEXT,
  note        TEXT,
  posted_on   DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS posts_product_idx ON posts(product_id, posted_on DESC);

CREATE TABLE IF NOT EXISTS messages (
  id          BIGSERIAL PRIMARY KEY,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  task_id     INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_product_idx ON messages(product_id, id);

CREATE TABLE IF NOT EXISTS chat_reads (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id   INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  last_read_id BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, product_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id          BIGSERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT,
  link        TEXT,
  product_id  INTEGER REFERENCES products(id) ON DELETE CASCADE,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id, read_at, created_at DESC);
`;

// v3 — full task management, comments, link library, email log, reminders, AI drafts
const SCHEMA_V3 = `
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'post';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS progress INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS ai_generated BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS ai_reason TEXT;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS seen_at TIMESTAMPTZ;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check CHECK (status IN ('draft','todo','in_progress','done','cancelled'));
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_progress_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_progress_check CHECK (progress BETWEEN 0 AND 100);
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_kind_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_kind_check CHECK (kind IN ('post','general'));

CREATE TABLE IF NOT EXISTS task_comments (
  id          BIGSERIAL PRIMARY KEY,
  task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL DEFAULT 'comment' CHECK (kind IN ('comment','progress','clarification','system')),
  body        TEXT,
  progress    INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_comments_idx ON task_comments(task_id, id);

-- Permanent product library entries for external links (Google Drive, YouTube, etc.).
-- Uploaded files live in "files"; the library view combines both.
CREATE TABLE IF NOT EXISTS links (
  id            SERIAL PRIMARY KEY,
  product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  task_id       INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  url           TEXT NOT NULL,
  content_type  TEXT NOT NULL DEFAULT 'link',
  note          TEXT,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS links_product_idx ON links(product_id, created_at DESC);
ALTER TABLE files ADD COLUMN IF NOT EXISTS content_type TEXT;

CREATE TABLE IF NOT EXISTS email_log (
  id          BIGSERIAL PRIMARY KEY,
  to_email    TEXT NOT NULL,
  subject     TEXT NOT NULL,
  kind        TEXT,
  status      TEXT NOT NULL,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task_reminders (
  task_id   INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind      TEXT NOT NULL,
  sent_on   DATE NOT NULL,
  PRIMARY KEY (task_id, kind, sent_on)
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_notifications BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS job_runs (key TEXT NOT NULL, run_on DATE NOT NULL, PRIMARY KEY (key, run_on));

ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_email TEXT;

-- AI keys managed by the admin in Settings (several accounts per provider, tried in position order)
CREATE TABLE IF NOT EXISTS ai_keys (
  id          SERIAL PRIMARY KEY,
  provider    TEXT NOT NULL,
  label       TEXT NOT NULL,
  key_enc     TEXT NOT NULL,
  key_hint    TEXT,
  models      TEXT[] NOT NULL DEFAULT '{}',
  base_url    TEXT,
  position    INTEGER NOT NULL DEFAULT 0,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  state       TEXT NOT NULL DEFAULT 'unknown',
  message     TEXT,
  last_model  TEXT,
  checked_at  TIMESTAMPTZ,
  last_ok_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_status (
  provider    TEXT PRIMARY KEY,
  state       TEXT NOT NULL,
  message     TEXT,
  model       TEXT,
  checked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_ok_at  TIMESTAMPTZ
);
`;


// v4 — custom job titles, task time tracking, team messaging, announcements & meetings
const SCHEMA_V4 = `
ALTER TABLE users ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_message_team BOOLEAN NOT NULL DEFAULT FALSE;
-- Removed team members keep their history; the login is closed and the email freed
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS former_email TEXT;

-- Time spent on tasks: a running timer has ended_at NULL; manual entries have both set.
CREATE TABLE IF NOT EXISTS task_time (
  id          BIGSERIAL PRIMARY KEY,
  task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at    TIMESTAMPTZ,
  minutes     INTEGER,
  source      TEXT NOT NULL DEFAULT 'timer' CHECK (source IN ('timer','manual')),
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_time_user_idx ON task_time(user_id, started_at);
CREATE INDEX IF NOT EXISTS task_time_task_idx ON task_time(task_id);
CREATE UNIQUE INDEX IF NOT EXISTS task_time_one_running ON task_time(user_id) WHERE ended_at IS NULL;

-- Direct messages between two people
CREATE TABLE IF NOT EXISTS direct_messages (
  id            BIGSERIAL PRIMARY KEY,
  sender_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body          TEXT NOT NULL,
  important     BOOLEAN NOT NULL DEFAULT FALSE,
  read_at       TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dm_pair_idx ON direct_messages(LEAST(sender_id, recipient_id), GREATEST(sender_id, recipient_id), id);
CREATE INDEX IF NOT EXISTS dm_unread_idx ON direct_messages(recipient_id) WHERE read_at IS NULL;

-- Throttle for message emails: at most one email per conversation every 30 minutes unless important
CREATE TABLE IF NOT EXISTS dm_email_state (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  peer_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emailed_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (user_id, peer_id)
);

-- Announcements, meetings, reminders and deadlines sent by the admin
CREATE TABLE IF NOT EXISTS announcements (
  id          SERIAL PRIMARY KEY,
  kind        TEXT NOT NULL DEFAULT 'announcement' CHECK (kind IN ('announcement','meeting','reminder','deadline')),
  title       TEXT NOT NULL,
  body        TEXT,
  event_at    TIMESTAMPTZ,
  location    TEXT,
  important   BOOLEAN NOT NULL DEFAULT FALSE,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled   BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS announcement_recipients (
  announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at         TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  PRIMARY KEY (announcement_id, user_id)
);
CREATE INDEX IF NOT EXISTS ann_recip_user_idx ON announcement_recipients(user_id);
CREATE TABLE IF NOT EXISTS announcement_reminders (
  announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, kind)
);
`;

// v5 — KPIs per product: product type, product-scoped metrics, automatic social metrics
const SCHEMA_V5 = `
ALTER TABLE products ADD COLUMN IF NOT EXISTS category TEXT;
-- When the admin last looked at Team activity in the bell
ALTER TABLE users ADD COLUMN IF NOT EXISTS activity_seen_at TIMESTAMPTZ;
ALTER TABLE metrics ADD COLUMN IF NOT EXISTS product_id INTEGER REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE metrics ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE metrics DROP CONSTRAINT IF EXISTS metrics_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS metrics_scope_name ON metrics ((coalesce(product_id, 0)), (lower(name)));
CREATE INDEX IF NOT EXISTS metrics_product_idx ON metrics(product_id);
`;

// Default checklist (from the original Social Media Tracker sheet). No account
// data, credentials or personal info is seeded — that lives only in the database.
const DEFAULT_TASKS = [
  ['Open each account and check notifications', 'All accounts', 'daily'],
  ['Reply to DMs / messages', 'All accounts', 'daily'],
  ['Reply to comments and mentions', 'All accounts', 'daily'],
  ['Post / story published as per content calendar', 'All accounts', 'daily'],
  ["Note today's followers and following count", 'All accounts', 'daily'],
  ['Check for login alerts or security emails', 'All accounts + linked emails', 'daily'],
  ['YouTube: comments, views, upload status', 'YouTube channels', 'daily'],
  ['Website is up and loading; check contact messages', 'Websites', 'daily'],
  ['Lecture video uploaded / scheduled', 'Website + YouTube', 'daily'],
  ['Play Store testing: tester count and feedback', 'Android apps', 'daily'],
  ['Check trending hashtags / competitor posts (10 min)', 'Growth accounts', 'daily'],
  ["Plan tomorrow's post and prepare content", 'All accounts', 'daily'],
  ['Export / screenshot insights (reach, top posts, audience) for each account', 'All accounts', 'weekly'],
  ["Review next week's content calendar; check posts are scheduled", 'All accounts', 'weekly'],
  ['Remove spam followers, reply to unanswered comments', 'All accounts', 'weekly'],
  ['Update bio, link and profile picture where needed; confirm links work', 'All accounts', 'monthly'],
  ['Confirm 2FA is on and recovery email/phone is correct for every account', 'All accounts', 'monthly'],
  ['Back up content (videos, graphics, captions) and question banks', 'Storage', 'monthly'],
  ['Check database usage and backup status', 'Infrastructure', 'monthly'],
  ['Check domain, hosting and subscription renewal dates', 'Infrastructure', 'monthly'],
  ['Check Google Play Console messages and closed-testing status', 'Android apps', 'monthly'],
  ['Review ads / payments (if any) against results', 'Finance', 'monthly'],
  ['Compare this month with last month and write the report', 'Reports', 'monthly'],
];

// [name, category, unit, aggregation, higher_is_better]
const DEFAULT_METRICS = [
  ['Revenue', 'Business', 'PKR', 'sum', true],
  ['New leads / inquiries', 'Business', null, 'sum', true],
  ['New clients / orders', 'Business', null, 'sum', true],
  ['Ad spend', 'Business', 'PKR', 'sum', false],
  ['Website visitors', 'Websites', null, 'sum', true],
  ['New signups / students', 'Websites', null, 'sum', true],
  ['Lecture videos uploaded', 'Content', null, 'sum', true],
  ['MCQs added to the bank', 'Content', null, 'sum', true],
  ['YouTube subscribers gained', 'YouTube', null, 'sum', true],
  ['YouTube views', 'YouTube', null, 'sum', true],
  ['YouTube watch time', 'YouTube', 'hours', 'sum', true],
  ['Play Store testers opted in', 'Apps', null, 'last', true],
  ['Security issues / locked accounts', 'Security', null, 'sum', false],
];

export async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(SCHEMA);
    await client.query(SCHEMA_V2);
    await client.query(SCHEMA_V3);
    await client.query(SCHEMA_V4);
    await client.query(SCHEMA_V5);
    const { rows: t } = await client.query('SELECT count(*)::int AS n FROM checklist_tasks');
    if (t[0].n === 0) {
      for (const [i, [title, scope, frequency]] of DEFAULT_TASKS.entries()) {
        await client.query(
          'INSERT INTO checklist_tasks (title, scope, frequency, position) VALUES ($1,$2,$3,$4)',
          [title, scope, frequency, i]
        );
      }
    }
    const { rows: m } = await client.query('SELECT count(*)::int AS n FROM metrics');
    if (m[0].n === 0) {
      for (const [i, [name, category, unit, aggregation, hib]] of DEFAULT_METRICS.entries()) {
        await client.query(
          'INSERT INTO metrics (name, category, unit, aggregation, higher_is_better, position) VALUES ($1,$2,$3,$4,$5,$6)',
          [name, category, unit, aggregation, hib, i]
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Allow `npm run migrate`
if (import.meta.url === `file://${process.argv[1]}`) {
  migrate()
    .then(() => {
      console.log('Migration complete');
      return pool.end();
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
