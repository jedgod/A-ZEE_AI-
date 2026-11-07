CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS search_queries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id text NOT NULL, user_id text NOT NULL,
 query text NOT NULL, answer text NOT NULL, sources jsonb NOT NULL DEFAULT '[]'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS search_queries_scope ON search_queries(tenant_id,user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS agent_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id text NOT NULL, user_id text NOT NULL,
 repo_path text NOT NULL, command text NOT NULL, status text NOT NULL DEFAULT 'queued',
 result jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_jobs_scope ON agent_jobs(tenant_id,user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS audit_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, tenant_id text NOT NULL,
 user_id text NOT NULL, action text NOT NULL, resource_id text,
 details jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
