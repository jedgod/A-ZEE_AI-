-- ============================================================
-- 01_INTAKE / PRIORITY / POSTGRESQL
-- File: migrations/intake_priority.pg.sql
-- ============================================================


CREATE TABLE IF NOT EXISTS intake_priority (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  schema_version TEXT NOT NULL DEFAULT '1.0.0',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS intake_priority_owner_request
  ON intake_priority(user_id, request_id);

-- Parameterized INSERT, run through your backend driver:
-- INSERT INTO intake_priority
--   (id, user_id, request_id, payload)
-- VALUES ($1, $2, $3, $4::jsonb);
--
-- Bind JSON.stringify(validatedPayload) as the payload.
-- Never interpolate user input into SQL.
-- Authorize ownership of request_id before writing.
-- Add request/user foreign keys using your application schema.
-- Add retention and deletion policies for sensitive intake data.
-- Enable tenant isolation / RLS as appropriate for your deployment.
