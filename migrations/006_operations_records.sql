-- Shared operational records for 13_FEEDBACK and 14_OBSERVABILITY
-- (from 13_FEEDBACK/*/postgresql.sql and 14_OBSERVABILITY/*/postgresql.sql).
-- Metadata only: no prompt or answer text. Rows expire (expires_at); the app purges them.

CREATE TABLE IF NOT EXISTS operations_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  module TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS operations_records_owner_request
  ON operations_records(tenant_id, user_id, request_id, module);

CREATE INDEX IF NOT EXISTS operations_records_expiry
  ON operations_records(expires_at);

CREATE INDEX IF NOT EXISTS operations_records_module_created
  ON operations_records(module, created_at DESC);
