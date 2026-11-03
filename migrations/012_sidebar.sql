-- 012: server-backed sidebar (groups/items configuration, projects, chat metadata).
-- Adapted from sql/sidebar.sql + sidebar-extensions.sql: users.id is TEXT here, items gain an
-- `enabled` flag so features that don't exist yet stay hidden until switched on, and the
-- workspace's real modes (Research, Code workspace) are seeded alongside Chat.
-- Chat MESSAGES are not stored here: they stay in the browser. Only title, project and pin are.

CREATE TABLE IF NOT EXISTS sidebar_groups (
  id TEXT PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9-]{0,39}$'),
  label TEXT CHECK (label IS NULL OR length(label) BETWEEN 1 AND 60),
  sort_order INTEGER NOT NULL DEFAULT 0,
  collapsible BOOLEAN NOT NULL DEFAULT false,
  show_more BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sidebar_items (
  id TEXT PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9-]{0,39}$'),
  group_id TEXT NOT NULL REFERENCES sidebar_groups(id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 60),
  icon TEXT CHECK (icon IS NULL OR icon ~ '^[a-z][a-z0-9-]{0,39}$'),   -- key for the frontend icon map
  -- Same-site paths only: no scheme, no protocol-relative URLs.
  href TEXT CHECK (href IS NULL OR (href ~ '^/[^/\\]' AND length(href) <= 200)),
  enabled BOOLEAN NOT NULL DEFAULT true,
  badge TEXT CHECK (badge IS NULL OR length(badge) BETWEEN 1 AND 12),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sidebar_items_group ON sidebar_items(group_id, sort_order);

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 40),
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS projects_owner_name ON projects(owner_id, lower(name));

CREATE TABLE IF NOT EXISTS chats (
  id UUID PRIMARY KEY,                       -- the id the browser generated for the conversation
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,   -- NULL = the default "General" project
  mode TEXT NOT NULL DEFAULT 'chat' CHECK (mode IN ('chat', 'code', 'research')),
  pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chats_owner_pinned ON chats(owner_id, pinned DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chats_project ON chats(project_id);

INSERT INTO sidebar_groups (id, label, sort_order, collapsible, show_more) VALUES
  ('main', NULL, 1, false, false),
  ('bots', 'A-Zee Bot', 2, false, false),
  ('projects', 'Projects', 3, true, true),
  ('chats', 'Chats', 4, true, false),
  ('plugins', NULL, 5, false, false)
ON CONFLICT (id) DO NOTHING;

-- imagine / automations / create-bot have no feature behind them yet: seeded disabled.
-- Enable one with: UPDATE sidebar_items SET enabled = true WHERE id = 'imagine';
INSERT INTO sidebar_items (id, group_id, label, icon, href, enabled, badge, sort_order) VALUES
  ('chat', 'main', 'Chat', 'chat', NULL, true, NULL, 1),
  ('research', 'main', 'Research', 'search', NULL, true, NULL, 2),
  ('code', 'main', 'Code workspace', 'code', NULL, true, 'DEV', 3),
  ('imagine', 'main', 'Imagine', 'imagine', NULL, false, NULL, 4),
  ('library', 'main', 'Library', 'library', NULL, true, NULL, 5),
  ('automations', 'main', 'Automations', 'automations', NULL, false, NULL, 6),
  ('create-bot', 'bots', 'Create a bot', 'plus', NULL, false, NULL, 1),
  ('plugins', 'plugins', 'Plugins', 'puzzle', '/extensions', true, NULL, 1)
ON CONFLICT (id) DO NOTHING;
