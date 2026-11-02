-- ============================================================
-- File: migrations/002_admin_sessions.sql
-- ============================================================
-- Legacy compatibility migration for the canonical admin runtime.
-- The runtime uses admin_* tables and keeps admin_sessions as the
-- single authoritative session table.

CREATE TABLE IF NOT EXISTS admin_sessions (
  id UUID PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES admin_identities(id),
  tenant_id UUID NOT NULL REFERENCES admin_tenants(id),
  role TEXT NOT NULL CHECK (role IN ('owner','admin','reviewer','operator','viewer')),
  platform BOOLEAN NOT NULL DEFAULT false,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS admin_sessions_user_tenant_idx
  ON admin_sessions(user_id, tenant_id);

CREATE INDEX IF NOT EXISTS admin_sessions_expiry_idx
  ON admin_sessions(expires_at);

CREATE INDEX IF NOT EXISTS admin_sessions_tenant_idx
  ON admin_sessions(tenant_id);
