-- ============================================================
-- 15_ADMIN / POSTGRESQL MIGRATION
-- ============================================================

CREATE TABLE IF NOT EXISTS admin_tenants (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  owner_user_id UUID,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','review','suspended')),
  revision INTEGER NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_identities (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  active_tenant_id UUID,
  platform_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_memberships (
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','reviewer','operator','viewer')),
  status TEXT NOT NULL CHECK (status IN ('active','suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS admin_records (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  module TEXT NOT NULL,
  payload JSONB NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS admin_decisions (
  record_id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  requester_id UUID NOT NULL,
  reviewer_id UUID,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected')),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_audit (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  actor_id UUID NOT NULL,
  action TEXT NOT NULL,
  resource_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_rate_limits (
  key TEXT NOT NULL,
  bucket BIGINT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (key, bucket)
);

CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','reviewer','operator','viewer')),
  status TEXT NOT NULL CHECK (status IN ('active','invited','disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_roles (
  role TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  permissions TEXT NOT NULL CHECK (jsonb_typeof(permissions::jsonb) = 'array')
);

CREATE TABLE IF NOT EXISTS admin_approvals (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  actor_id UUID NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected')),
  requested_at TEXT NOT NULL,
  reviewed_at TEXT
);

CREATE TABLE IF NOT EXISTS admin_policies (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  scope TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  version TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_model_registry (
  id UUID PRIMARY KEY,
  provider TEXT NOT NULL,
  model_name TEXT NOT NULL,
  version TEXT NOT NULL,
  approval_state TEXT NOT NULL CHECK (approval_state IN ('approved','pending','restricted')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_billing_events (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  category TEXT NOT NULL,
  amount_usd NUMERIC(12,2) NOT NULL,
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_incidents (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  title TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  status TEXT NOT NULL CHECK (status IN ('open','investigating','mitigated','resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS admin_audit_events (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  actor_id UUID NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('success','failure')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
