-- Optional override table (add to your migrations if not already present)
CREATE TABLE IF NOT EXISTS account_overrides (
  user_id     TEXT PRIMARY KEY,
  allowed     BOOLEAN NOT NULL DEFAULT true,
  allowed_by  TEXT,
  allowed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
