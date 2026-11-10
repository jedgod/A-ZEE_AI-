-- Qorlla AI platform additive PostgreSQL schema. Run under a dedicated migration role.
BEGIN;
CREATE TABLE IF NOT EXISTS ai_provider_registry (
 provider_id text PRIMARY KEY, kind text NOT NULL CHECK (kind IN ('ollama','openai','gemini','xai','other')),
 enabled boolean NOT NULL DEFAULT false, private_only boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ai_model_registry (
 model_id text PRIMARY KEY, provider_id text NOT NULL REFERENCES ai_provider_registry(provider_id),
 upstream_model text NOT NULL, enabled boolean NOT NULL DEFAULT false,
 capability_json jsonb NOT NULL DEFAULT '{}'::jsonb,
 max_output_tokens integer NOT NULL CHECK(max_output_tokens BETWEEN 1 AND 32768)
);
CREATE TABLE IF NOT EXISTS ai_tenant_model_entitlements (
 tenant_id text NOT NULL, model_id text NOT NULL REFERENCES ai_model_registry(model_id),
 daily_request_limit integer NOT NULL CHECK(daily_request_limit >= 0),
 daily_token_limit bigint NOT NULL CHECK(daily_token_limit >= 0),
 PRIMARY KEY (tenant_id,model_id)
);
CREATE TABLE IF NOT EXISTS ai_inference_requests (
 request_id uuid PRIMARY KEY, tenant_id text NOT NULL, subject_id text NOT NULL,
 model_id text NOT NULL REFERENCES ai_model_registry(model_id),
 request_hash text NOT NULL, status text NOT NULL CHECK(status IN ('reserved','completed','failed')),
 input_tokens integer CHECK(input_tokens >= 0), output_tokens integer CHECK(output_tokens >= 0),
 error_code text, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 UNIQUE (tenant_id,request_id)
);
CREATE INDEX IF NOT EXISTS ai_inference_requests_tenant_created ON ai_inference_requests(tenant_id,created_at DESC);
CREATE TABLE IF NOT EXISTS ai_daily_usage (
 tenant_id text NOT NULL, model_id text NOT NULL REFERENCES ai_model_registry(model_id),
 usage_day date NOT NULL, requests integer NOT NULL DEFAULT 0 CHECK(requests >= 0),
 tokens bigint NOT NULL DEFAULT 0 CHECK(tokens >= 0),
 PRIMARY KEY(tenant_id,model_id,usage_day)
);
CREATE TABLE IF NOT EXISTS ai_audit_events (
 event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, tenant_id text NOT NULL,
 actor_id text NOT NULL, action text NOT NULL, request_id uuid,
 event_at timestamptz NOT NULL DEFAULT now(), metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
-- Never persist prompts, model responses, API keys or bearer tokens in audit metadata.
-- Revoke default PUBLIC privileges and grant only necessary rights to the gateway role.
COMMIT;
