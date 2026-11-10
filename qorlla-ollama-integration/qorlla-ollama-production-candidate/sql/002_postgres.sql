BEGIN;
ALTER TABLE ai_inference_requests ADD COLUMN IF NOT EXISTS reserved_tokens bigint NOT NULL DEFAULT 0;
ALTER TABLE ai_inference_requests ADD COLUMN IF NOT EXISTS usage_day date;
ALTER TABLE ai_inference_requests ADD COLUMN IF NOT EXISTS lease_owner text;
ALTER TABLE ai_inference_requests ADD COLUMN IF NOT EXISTS lease_epoch bigint NOT NULL DEFAULT 0;
ALTER TABLE ai_inference_requests ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;
ALTER TABLE ai_inference_requests ADD COLUMN IF NOT EXISTS response_json jsonb;
ALTER TABLE ai_inference_requests ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE ai_inference_requests DROP CONSTRAINT IF EXISTS ai_inference_requests_status_check;
ALTER TABLE ai_inference_requests ADD CONSTRAINT ai_inference_requests_status_check CHECK(status IN ('reserved','running','completed','failed','cancelled','recovery_required'));
CREATE INDEX IF NOT EXISTS ai_inference_requests_lease_idx ON ai_inference_requests(status,lease_expires_at);
CREATE TABLE IF NOT EXISTS ai_tenant_limits (
 tenant_id text PRIMARY KEY, max_concurrent integer NOT NULL CHECK(max_concurrent BETWEEN 1 AND 10000)
);
CREATE TABLE IF NOT EXISTS ai_tenant_active (
 tenant_id text PRIMARY KEY, active_count integer NOT NULL DEFAULT 0 CHECK(active_count >= 0)
);
COMMIT;
