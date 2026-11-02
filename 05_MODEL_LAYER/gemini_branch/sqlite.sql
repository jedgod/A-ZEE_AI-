-- ============================================================
-- 05_MODEL_LAYER / GEMINI_BRANCH / PERSISTENCE
-- Dialect: SQLite
-- ============================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS model_layer_config (
  module TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  settings TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(settings)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS model_layer_runs (
  id TEXT PRIMARY KEY,
  module TEXT NOT NULL REFERENCES model_layer_config(module),
  status TEXT NOT NULL CHECK (
    status IN ('queued', 'running', 'succeeded', 'failed')
  ),
  summary TEXT CHECK (summary IS NULL OR json_valid(summary)),
  latency_ms INTEGER CHECK (latency_ms >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS model_layer_runs_module_time
  ON model_layer_runs(module, created_at);

INSERT INTO model_layer_config (module, settings)
VALUES ('gemini_branch', '{"max_output_tokens":2048,"timeout_seconds":60}')
ON CONFLICT (module) DO NOTHING;

-- Runtime writes MUST use bound parameters, not interpolation.
-- PostgreSQL: $1, $2, ...
-- SQLite: ?, ?, ...
-- Generate run IDs in your application.
-- Apply migrations with a migration tool; enforce authorization.
-- Persist summaries, not credentials or hidden reasoning.
-- SQLite JSON functions are required; use a supported version.
