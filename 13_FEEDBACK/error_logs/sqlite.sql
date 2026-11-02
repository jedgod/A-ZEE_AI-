-- ============================================================
-- 13_FEEDBACK / ERROR_LOGS / SQLITE
-- Shared operational record migration
-- ============================================================

CREATE TABLE IF NOT EXISTS operations_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  module TEXT NOT NULL,
  payload TEXT NOT NULL
    CHECK (json_valid(payload)),
  created_at TEXT NOT NULL
    DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS operations_records_owner_request
  ON operations_records(tenant_id, user_id, request_id, module);

CREATE INDEX IF NOT EXISTS operations_records_expiry
  ON operations_records(expires_at);

-- Parameterized runtime INSERT:
-- INSERT INTO operations_records
-- (id, tenant_id, user_id, request_id, module, payload, expires_at)
-- VALUES (?, ?, ?, ?, ?, ?, ?);
--
-- Bind module = 'error_logs'.
-- This shared table supports operational records, not all adapters.
-- Approved artifact storage, sources, improvement queues,
-- telemetry backends, and audit sinks need dedicated implementations.
-- Scope reads/writes to authenticated tenant and user ownership.
-- Add request/user foreign keys using your application schema.
-- Configure retention deletion and encrypted storage as required.
-- No raw prompts, secrets, or private reasoning in telemetry.
-- Requires SQLite JSON functions; use consistent UTC timestamps.


