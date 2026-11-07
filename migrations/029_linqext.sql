-- AZLinqext (reply assist): an idempotency log so a retried request returns the same reply and is
-- not counted twice. Plans, entitlements and monthly usage come from A-Zee's own tables.
-- Rows are deleted with the account and after 7 days.
CREATE TABLE IF NOT EXISTS linqext_requests (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id UUID NOT NULL,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, request_id)
);
CREATE INDEX IF NOT EXISTS linqext_requests_created ON linqext_requests (created_at);
