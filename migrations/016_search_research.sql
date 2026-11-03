-- 016: A-Zee Smart Search and Deep Research.
-- Every answer records the sources used, retrieval time, model, and whether its claims were
-- verified against the retrieved text. Research jobs are durable: each step is checkpointed, so
-- an interrupted job resumes where it stopped. All rows are owner-scoped.

CREATE TABLE IF NOT EXISTS search_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL CHECK (url ~ '^https?://' AND length(url) <= 2048),
  domain TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(title) <= 300),
  excerpt TEXT NOT NULL CHECK (length(excerpt) <= 6000),
  published_at TIMESTAMPTZ,
  relevance REAL,
  provider TEXT NOT NULL,
  retrieved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, url)
);
CREATE INDEX IF NOT EXISTS search_sources_owner ON search_sources(owner_id, retrieved_at DESC);

CREATE TABLE IF NOT EXISTS search_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('query', 'verify', 'compare')),
  query TEXT NOT NULL CHECK (length(query) <= 2000),
  answer TEXT NOT NULL DEFAULT '' CHECK (length(answer) <= 60000),
  source_ids UUID[] NOT NULL DEFAULT '{}',
  claims JSONB NOT NULL DEFAULT '[]'::jsonb,
  verification JSONB NOT NULL DEFAULT '{}'::jsonb,
  model TEXT,
  provider TEXT NOT NULL,
  retrieved_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS search_answers_owner ON search_answers(owner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS research_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question TEXT NOT NULL CHECK (length(question) BETWEEN 3 AND 2000),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  phase TEXT NOT NULL DEFAULT 'plan' CHECK (phase IN ('plan', 'investigate', 'synthesize', 'done')),
  plan JSONB NOT NULL DEFAULT '[]'::jsonb,
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  report JSONB,
  error TEXT,
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS research_jobs_owner ON research_jobs(owner_id, created_at DESC);
-- One active job per owner.
CREATE UNIQUE INDEX IF NOT EXISTS research_jobs_one_active ON research_jobs(owner_id) WHERE status IN ('queued', 'running');

-- Sidebar: A-Zee Search in the main group (configurable like the other items).
INSERT INTO sidebar_items (id, group_id, label, icon, href, enabled, sort_order)
VALUES ('azee-search', 'main', 'A-Zee Search', 'globe', '/search', true, 2)
ON CONFLICT (id) DO NOTHING;
