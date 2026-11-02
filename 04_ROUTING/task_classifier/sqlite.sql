-- ============================================================
-- 04_ROUTING / TASK_CLASSIFIER / SQLITE
-- Shared configuration and decision-audit migration
-- ============================================================

CREATE TABLE IF NOT EXISTS routing_settings (
  tenant_id TEXT NOT NULL,
  module TEXT NOT NULL,
  config TEXT NOT NULL
    CHECK (json_valid(config)),
  version INTEGER NOT NULL CHECK (version > 0),
  updated_at TEXT NOT NULL
    DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, module)
);

CREATE TABLE IF NOT EXISTS routing_decisions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  module TEXT NOT NULL,
  selected_model TEXT,
  status TEXT NOT NULL CHECK (
    status IN ('selected', 'rejected', 'failed')
  ),
  metadata TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(metadata)),
  created_at TEXT NOT NULL
    DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS routing_decisions_tenant_request
  ON routing_decisions(tenant_id, request_id, created_at);

-- Runtime write using bound parameters:
-- INSERT INTO routing_decisions
-- (id, tenant_id, request_id, module, selected_model,
--  status, metadata, expires_at)
-- VALUES (?, ?, ?, ?, ?, ?, ?, ?);
--
-- Bind module = 'task_classifier'.
-- Store operational reasons, versions, and estimates only.
-- Do not store raw prompts, secrets, or internal reasoning.
-- Scope ALL reads and writes to authenticated tenant_id.
-- Add host-schema request/user foreign keys and retention jobs.
-- Keep pricing and measured latency in versioned registry storage.
-- Atomic budget reservations require a separate transactional ledger.
-- Requires SQLite JSON functions; use consistent UTC timestamps.
