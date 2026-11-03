-- Accounts (sidebar account menu), staff sign-in, and the complaints workflow.

-- ---------------------------------------------------------------------------
-- Accounts: the user's schema, PostgreSQL 18. One row may be the machine's
-- local account (is_local); preferences hold personalization settings.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  avatar_initials TEXT CHECK (length(avatar_initials) BETWEEN 1 AND 3),
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'plus', 'pro')),
  is_local BOOLEAN NOT NULL DEFAULT false,
  preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS users_single_local ON users ((is_local)) WHERE is_local;

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  is_personal BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deactivated')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_workspaces (
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  PRIMARY KEY (user_id, workspace_id)
);

-- ---------------------------------------------------------------------------
-- Staff sign-in: passwords for existing admin identities (scrypt, never plain).
ALTER TABLE admin_identities ADD COLUMN IF NOT EXISTS display_name TEXT;

CREATE TABLE IF NOT EXISTS admin_credentials (
  user_id UUID PRIMARY KEY REFERENCES admin_identities(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  must_change BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Operations: complaints flow open -> in_progress (assigned) -> pending_review
-- (staff resolution) -> resolved (admin approval). The CHECKs make the rules
-- hold even if application code is bypassed.
CREATE TABLE IF NOT EXISTS ops_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS complaints (
  id UUID PRIMARY KEY,
  number BIGINT GENERATED ALWAYS AS IDENTITY (START WITH 1001) UNIQUE,
  tenant_id UUID NOT NULL REFERENCES admin_tenants(id),
  source TEXT NOT NULL CHECK (source IN ('app', 'feedback', 'staff')),
  category TEXT NOT NULL DEFAULT 'support' CHECK (category IN ('bug', 'support', 'feedback', 'other')),
  reporter_ref TEXT CHECK (length(reporter_ref) <= 64),
  customer_name TEXT NOT NULL CHECK (length(customer_name) BETWEEN 1 AND 100),
  customer_contact TEXT CHECK (length(customer_contact) <= 254),
  subject TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 150),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'pending_review', 'resolved')),
  assigned_to UUID REFERENCES admin_identities(id),
  resolution TEXT CHECK (length(resolution) <= 5000),
  review_note TEXT CHECK (length(review_note) <= 2000),
  approved_by UUID REFERENCES admin_identities(id),
  request_id UUID,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  CHECK (status = 'open' OR assigned_to IS NOT NULL),
  CHECK (status NOT IN ('pending_review', 'resolved') OR length(trim(resolution)) BETWEEN 1 AND 5000),
  CHECK (status <> 'resolved' OR (approved_by IS NOT NULL AND resolved_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS complaints_queue ON complaints (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS complaints_assignment ON complaints (tenant_id, assigned_to);
CREATE INDEX IF NOT EXISTS complaints_reporter ON complaints (reporter_ref, created_at DESC);

-- Append-only activity log; details never include complaint bodies.
CREATE TABLE IF NOT EXISTS complaint_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES admin_tenants(id),
  complaint_id UUID REFERENCES complaints(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES admin_identities(id),
  actor_label TEXT NOT NULL,
  action TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS complaint_events_recent ON complaint_events (tenant_id, created_at DESC);

-- Customer notifications are queued here; a worker must send them (none is included).
CREATE TABLE IF NOT EXISTS notification_outbox (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES admin_tenants(id),
  complaint_id UUID NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  recipient TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (complaint_id, event)
);
