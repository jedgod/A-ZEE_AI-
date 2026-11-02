-- ============================================================
-- 05_MODEL_LAYER / SPECIALIST_MODELS / PERSISTENCE
-- Dialect: PostgreSQL
-- ============================================================


CREATE TABLE IF NOT EXISTS model_layer_config (
  module TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  settings JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS model_layer_runs (
  id TEXT PRIMARY KEY,
  module TEXT NOT NULL REFERENCES model_layer_config(module),
  status TEXT NOT NULL CHECK (
    status IN ('queued', 'running', 'succeeded', 'failed')
  ),
  summary JSONB,
  latency_ms INTEGER CHECK (latency_ms >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS model_layer_runs_module_time
  ON model_layer_runs(module, created_at);

INSERT INTO model_layer_config (module, settings)
VALUES ('specialist_models', '{"max_output_tokens":2048,"timeout_seconds":60}'::jsonb)
ON CONFLICT (module) DO NOTHING;

-- Runtime writes MUST use bound parameters, not interpolation.
-- PostgreSQL: $1, $2, ...
-- SQLite: ?, ?, ...
-- Generate run IDs in your application.
-- Apply migrations with a migration tool; enforce authorization.
-- Persist summaries, not credentials or hidden reasoning.
-- Add tenant isolation / RLS for multi-tenant deployments.
