-- 018: AI Code Agent (inspect → plan → generate → review → approve → apply → rollback).
-- Patches are stored, never applied, until the owner approves the exact patch hash. Each change
-- keeps a snapshot of the file it replaces (base_content + base_hash) so rollback restores only the
-- agent's own changes, and only while the file still holds what the agent wrote.

CREATE TABLE IF NOT EXISTS code_agent_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repo TEXT NOT NULL CHECK (repo ~ '^[A-Za-z0-9._-]{1,100}$'),
  instruction TEXT NOT NULL CHECK (length(instruction) BETWEEN 3 AND 4000),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'planned', 'review', 'approved', 'applying', 'applied', 'rolling_back', 'rolled_back', 'stale', 'failed')),
  plan JSONB,
  explanation TEXT CHECK (explanation IS NULL OR length(explanation) <= 8000),
  review JSONB NOT NULL DEFAULT '[]',
  patch_hash TEXT,
  patch_version INTEGER NOT NULL DEFAULT 0,
  approved_hash TEXT,
  approved_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ,
  rolled_back_at TIMESTAMPTZ,
  created_dirs JSONB NOT NULL DEFAULT '[]',
  model TEXT,
  error TEXT CHECK (error IS NULL OR length(error) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS code_agent_tasks_owner ON code_agent_tasks(owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS code_agent_changes (
  task_id UUID NOT NULL REFERENCES code_agent_tasks(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  path TEXT NOT NULL CHECK (length(path) <= 400),
  action TEXT NOT NULL CHECK (action IN ('create', 'modify', 'delete')),
  base_hash TEXT,
  base_content TEXT,
  new_hash TEXT,
  new_content TEXT,
  diff TEXT NOT NULL,
  additions INTEGER NOT NULL,
  deletions INTEGER NOT NULL,
  PRIMARY KEY (task_id, position),
  UNIQUE (task_id, path)
);

CREATE TABLE IF NOT EXISTS code_agent_audit (
  id BIGSERIAL PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id UUID REFERENCES code_agent_tasks(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (length(action) <= 40),
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'denied')),
  patch_hash TEXT,
  detail TEXT CHECK (detail IS NULL OR length(detail) <= 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS code_agent_audit_owner ON code_agent_audit(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS code_agent_audit_task ON code_agent_audit(task_id, created_at);
