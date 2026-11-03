-- 020: A-Zee Search Index (PostgreSQL full-text search).
-- Each account indexes documents it explicitly adds into its own collections (text it provides, or
-- one GitHub file / Google Drive document it selects through a read-only connector). Nothing is
-- indexed automatically. Chunks carry owner and collection so every query is filtered by both.
-- Vector search (pgvector) is not part of this migration: the extension isn't installed.

CREATE TABLE IF NOT EXISTS search_index_collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS search_index_collections_name ON search_index_collections(owner_id, lower(name));

CREATE TABLE IF NOT EXISTS search_index_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection_id UUID NOT NULL REFERENCES search_index_collections(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('text', 'github', 'google_drive')),
  -- github: owner/repo:path@ref, google_drive: file id; NULL for text.
  source_ref TEXT CHECK (source_ref IS NULL OR length(source_ref) <= 700),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  url TEXT CHECK (url IS NULL OR length(url) <= 1000),
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS search_index_documents_source ON search_index_documents(collection_id, source_type, source_ref) WHERE source_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS search_index_documents_hash ON search_index_documents(collection_id, content_hash);
CREATE INDEX IF NOT EXISTS search_index_documents_owner ON search_index_documents(owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS search_index_chunks (
  id BIGSERIAL PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES search_index_documents(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  collection_id UUID NOT NULL,
  position INTEGER NOT NULL,
  start_offset INTEGER NOT NULL,
  end_offset INTEGER NOT NULL,
  content TEXT NOT NULL,
  tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  UNIQUE (document_id, position)
);
CREATE INDEX IF NOT EXISTS search_index_chunks_tsv ON search_index_chunks USING GIN (tsv);
CREATE INDEX IF NOT EXISTS search_index_chunks_scope ON search_index_chunks(owner_id, collection_id);
