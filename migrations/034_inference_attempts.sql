-- Fencing tokens prevent a timed-out worker from completing/refunding a newer attempt.
ALTER TABLE linqext_requests ADD COLUMN IF NOT EXISTS attempt_id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE aztrade_ai_requests ADD COLUMN IF NOT EXISTS attempt_id uuid NOT NULL DEFAULT gen_random_uuid();
CREATE INDEX IF NOT EXISTS linqext_requests_recovery ON linqext_requests(created_at) WHERE status='running';
CREATE INDEX IF NOT EXISTS aztrade_ai_requests_recovery ON aztrade_ai_requests(created_at) WHERE status='running';
