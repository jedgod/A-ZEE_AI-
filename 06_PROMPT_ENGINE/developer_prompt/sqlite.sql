-- ============================================================
-- 06_PROMPT_ENGINE / DEVELOPER_PROMPT / SQLITE
-- Shared versioned settings and execution audit
-- ============================================================

CREATE TABLE IF NOT EXISTS execution_module_settings (
  tenant_id TEXT NOT NULL,
  module TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  enabled INTEGER NOT NULL DEFAULT 0
    CHECK (enabled IN (0, 1)),
  config TEXT NOT NULL
    CHECK (json_valid(config)),
  updated_at TEXT NOT NULL
    DEFAULT CURRENT_TIMESTAMP,
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
  metadata TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(metadata)),
  created_at TEXT NOT NULL
    DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS execution_audit_owner_request
  ON execution_module_audit(tenant_id, user_id, request_id);

-- Use bound parameters through your backend database driver:
-- INSERT INTO execution_module_audit
-- (id, tenant_id, user_id, request_id, module,
--  status, metadata, expires_at)
-- VALUES (?, ?, ?, ?, ?, ?, ?, ?);
--
-- Bind module = 'developer_prompt'.
-- Metadata: policy version, duration, error category, invocation ID.
-- Never persist secrets, raw tool output, or private reasoning.
-- Authorize every read/write using authenticated tenant/user scope.
-- Add user/request foreign keys from your host application schema.
-- Expire audit records through a scheduled retention job.
-- Store credentials in a server secret manager, not config.
-- Requires SQLite JSON functions; use consistent UTC timestamps.
