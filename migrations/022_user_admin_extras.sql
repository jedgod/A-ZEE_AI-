-- Tags, notes and saved views for the admin Users page. Everything is tenant-scoped.
CREATE TABLE IF NOT EXISTS admin_tags (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  color TEXT NOT NULL DEFAULT '#6366f1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS admin_user_tags (
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  tag_id UUID NOT NULL REFERENCES admin_tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, user_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_admin_user_tags_tag ON admin_user_tags(tag_id);

CREATE TABLE IF NOT EXISTS admin_user_notes (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  author_id UUID NOT NULL,
  content TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_user_notes_user ON admin_user_notes(tenant_id, user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_saved_views (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  owner_id UUID NOT NULL,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  filters JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_saved_views_owner ON admin_saved_views(tenant_id, owner_id);
