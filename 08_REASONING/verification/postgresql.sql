-- ============================================================
-- 08_REASONING / VERIFICATION / POSTGRESQL
-- Shared operational persistence migration
-- ============================================================

CREATE TABLE IF NOT EXISTS reliability_module_config (
  tenant_id TEXT NOT NULL,
  module TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  config JSONB NOT NULL
    ,
  updated_at TIMESTAMPTZ NOT NULL
    DEFAULT NOW(),
  PRIMARY KEY (tenant_id, module)
);

CREATE TABLE IF NOT EXISTS reliability_module_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  module TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('running', 'passed', 'failed', 'review')
  ),
  metadata JSONB NOT NULL DEFAULT '{}'
    ,
  created_at TIMESTAMPTZ NOT NULL
    DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS reliability_runs_owner_request
  ON reliability_module_runs(tenant_id, user_id, request_id);

-- Runtime insert with bound parameters:
-- INSERT INTO reliability_module_runs
-- (id, tenant_id, user_id, request_id, module,
--  status, metadata, expires_at)
-- VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8);
--
-- Bind module = 'verification'.
-- Record rubric/schema versions, source IDs, duration, and outcomes.
-- Do not record private reasoning, secrets, or raw sensitive inputs.
-- Scope every operation to authenticated tenant/user ownership.
-- Add foreign keys from your host schema and retention cleanup.
-- Use separate encrypted artifact storage for approved final outputs.
-- Configure tenant-aware RLS where appropriate.
