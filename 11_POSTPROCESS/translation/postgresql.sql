-- ============================================================
-- 11_POSTPROCESS / TRANSLATION / POSTGRESQL
-- Shared operational record migration
-- ============================================================

CREATE TABLE IF NOT EXISTS operations_records (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  module TEXT NOT NULL,
  payload JSONB NOT NULL
    ,
  created_at TIMESTAMPTZ NOT NULL
    DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS operations_records_owner_request
  ON operations_records(tenant_id, user_id, request_id, module);

CREATE INDEX IF NOT EXISTS operations_records_expiry
  ON operations_records(expires_at);

-- Parameterized runtime INSERT:
-- INSERT INTO operations_records
-- (id, tenant_id, user_id, request_id, module, payload, expires_at)
-- VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7);
--
-- Bind module = 'translation'.
-- This shared table supports operational records, not all adapters.
-- Approved artifact storage, sources, improvement queues,
-- telemetry backends, and audit sinks need dedicated implementations.
-- Scope reads/writes to authenticated tenant and user ownership.
-- Add request/user foreign keys using your application schema.
-- Configure retention deletion and encrypted storage as required.
-- No raw prompts, secrets, or private reasoning in telemetry.
-- Configure tenant-aware RLS.


