-- Local single-process SQLite development schema; not a shared multi-node production DB.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS ai_provider_registry (
 provider_id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('ollama','openai','gemini','xai','other')),
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 private_only INTEGER NOT NULL DEFAULT 0 CHECK(private_only IN (0,1)),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS ai_model_registry (
 model_id TEXT PRIMARY KEY, provider_id TEXT NOT NULL REFERENCES ai_provider_registry(provider_id),
 upstream_model TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 capability_json TEXT NOT NULL DEFAULT '{}', max_output_tokens INTEGER NOT NULL CHECK(max_output_tokens BETWEEN 1 AND 32768)
);
CREATE TABLE IF NOT EXISTS ai_tenant_model_entitlements (
 tenant_id TEXT NOT NULL, model_id TEXT NOT NULL REFERENCES ai_model_registry(model_id),
 daily_request_limit INTEGER NOT NULL CHECK(daily_request_limit >= 0),
 daily_token_limit INTEGER NOT NULL CHECK(daily_token_limit >= 0),
 PRIMARY KEY(tenant_id,model_id)
);
CREATE TABLE IF NOT EXISTS ai_inference_requests (
 request_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, subject_id TEXT NOT NULL,
 model_id TEXT NOT NULL REFERENCES ai_model_registry(model_id), request_hash TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('reserved','completed','failed')),
 input_tokens INTEGER CHECK(input_tokens >= 0), output_tokens INTEGER CHECK(output_tokens >= 0),
 error_code TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TEXT
);
CREATE INDEX IF NOT EXISTS ai_inference_requests_tenant_created ON ai_inference_requests(tenant_id,created_at DESC);
CREATE TABLE IF NOT EXISTS ai_daily_usage (
 tenant_id TEXT NOT NULL, model_id TEXT NOT NULL REFERENCES ai_model_registry(model_id),
 usage_day TEXT NOT NULL, requests INTEGER NOT NULL DEFAULT 0 CHECK(requests >= 0),
 tokens INTEGER NOT NULL DEFAULT 0 CHECK(tokens >= 0), PRIMARY KEY(tenant_id,model_id,usage_day)
);
CREATE TABLE IF NOT EXISTS ai_audit_events (
 event_id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL,
 actor_id TEXT NOT NULL, action TEXT NOT NULL, request_id TEXT,
 event_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, metadata TEXT NOT NULL DEFAULT '{}'
);
