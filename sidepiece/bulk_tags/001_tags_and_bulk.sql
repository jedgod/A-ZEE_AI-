-- Tags and Bulk Actions migration
-- Run against your Postgres database

CREATE TABLE IF NOT EXISTS tags (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name        TEXT NOT NULL UNIQUE,
  color       TEXT NOT NULL DEFAULT '#6366f1',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_tags (
  user_id     TEXT NOT NULL,
  tag_id      TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_user_tags_user ON user_tags(user_id);
CREATE INDEX IF NOT EXISTS idx_user_tags_tag ON user_tags(tag_id);

-- Optional: audit log for bulk actions
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  admin_id    TEXT NOT NULL,
  action      TEXT NOT NULL,
  target_ids  TEXT[] NOT NULL,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
