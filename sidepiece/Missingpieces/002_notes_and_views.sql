-- Additional tables for Notes and Saved Views
-- Run after 001_tags_and_bulk.sql

CREATE TABLE IF NOT EXISTS user_notes (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id     TEXT NOT NULL,
  author_id   TEXT NOT NULL,
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_notes_user ON user_notes(user_id);

CREATE TABLE IF NOT EXISTS saved_views (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  admin_id    TEXT NOT NULL,
  name        TEXT NOT NULL,
  filters     JSONB NOT NULL DEFAULT '{}',
  is_default  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_saved_views_admin ON saved_views(admin_id);
