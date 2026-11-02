-- ============================================================
-- 07_TOOLS / CALCULATOR / POSTGRESQL
-- Shared versioned settings and execution audit
-- ============================================================

CREATE TABLE IF NOT EXISTS execution_module_settings (
  tenant_id TEXT NOT NULL,
  module TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  enabled BOOLEAN NOT NULL DEFAULT FALSE
    ,
  config JSONB NOT NULL
    ,
  updated_at TIMESTAMPTZ NOT NULL
    DEFAULT NOW(),
  PRIMARY KEY (tenant_id, module)
);

CREATE TABLE IF NOT EXISTS execution_module_audit (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  module TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('approved', 'denied', 'succeeded', 'failed')
  ),
  metadata JSONB NOT NULL DEFAULT '{}'
    ,
  created_at TIMESTAMPTZ NOT NULL
    DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS execution_audit_owner_request
  ON execution_module_audit(tenant_id, user_id, request_id);

-- Use bound parameters through your backend database driver:
-- INSERT INTO execution_module_audit
-- (id, tenant_id, user_id, request_id, module,
--  status, metadata, expires_at)
-- VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8);
--
-- Bind module = 'calculator'.
-- Metadata: policy version, duration, error category, invocation ID.
-- Never persist secrets, raw tool output, or private reasoning.
-- Authorize every read/write using authenticated tenant/user scope.
-- Add user/request foreign keys from your host application schema.
-- Expire audit records through a scheduled retention job.
-- Store credentials in a server secret manager, not config.
-- Configure tenant-aware RLS and reviewed policy migrations.
