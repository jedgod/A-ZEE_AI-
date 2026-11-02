-- ============================================================
-- 15_EXTENSIONS / POSTGRESQL MIGRATION
-- ============================================================

CREATE TABLE IF NOT EXISTS extension_installations (
  tenant_id TEXT NOT NULL,
  extension_id TEXT NOT NULL,
  approved_version TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  granted_permissions TEXT NOT NULL
    CHECK (jsonb_typeof(granted_permissions::jsonb) = 'array'),
  approved_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, extension_id)
);

CREATE TABLE IF NOT EXISTS extension_audit_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  extension_id TEXT NOT NULL,
  event TEXT NOT NULL CHECK (event IN ('configuration','execution')),
  status TEXT NOT NULL CHECK (status IN ('success','failure')),
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS extension_audit_events_tenant_time
  ON extension_audit_events(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS extension_audit_events_expiry
  ON extension_audit_events(expires_at);

-- TEXT timestamps use canonical UTC ISO-8601 in this portable scaffold.
-- Add tenant/user foreign keys to your host application schema.
-- Use parameterized writes and owner-scoped reads.
-- Schedule expiry deletion; audit integrity needs an independent sink.
-- Deploy tenant RLS where applicable; application role must not bypass it.
