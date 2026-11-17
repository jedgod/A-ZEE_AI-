-- Per-account/provider consent receipts and cross-worker cost/concurrency limits.
-- No image bytes, secrets or provider response bodies are stored here.
CREATE TABLE IF NOT EXISTS image_provider_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scan_id UUID REFERENCES image_scans(id) ON DELETE SET NULL,
  consent JSONB NOT NULL CHECK (jsonb_typeof(consent) = 'object'),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS image_provider_requests_owner_time ON image_provider_requests(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS image_provider_requests_active ON image_provider_requests(created_at) WHERE status = 'running';
