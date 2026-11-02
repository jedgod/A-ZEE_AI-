-- ============================================================
-- 01_INTAKE / USER_QUERY / SQLITE
-- File: migrations/intake_user_query.sqlite.sql
-- ============================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS intake_user_query (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  schema_version TEXT NOT NULL DEFAULT '1.0.0',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS intake_user_query_owner_request
  ON intake_user_query(user_id, request_id);

-- Parameterized INSERT, run through your backend driver:
-- INSERT INTO intake_user_query
--   (id, user_id, request_id, payload)
-- VALUES (?, ?, ?, ?);
--
-- Bind JSON.stringify(validatedPayload) as the payload.
-- Never interpolate user input into SQL.
-- Authorize ownership of request_id before writing.
-- Add request/user foreign keys using your application schema.
-- Add retention and deletion policies for sensitive intake data.
-- Requires SQLite JSON functions; JSON is stored as validated TEXT.
