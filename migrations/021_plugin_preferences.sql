-- 021: per-account plugin preferences (the Plugins panel): enabled toggle and settings.
-- enabled NULL = never toggled (a connected connector then counts as enabled).
-- Secret settings (API keys) are stored encrypted with CONNECTOR_TOKEN_KEY and never returned.

CREATE TABLE IF NOT EXISTS plugin_preferences (
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plugin_id TEXT NOT NULL CHECK (plugin_id ~ '^[a-z][a-z0-9_-]{1,63}$'),
  enabled BOOLEAN,
  settings JSONB NOT NULL DEFAULT '{}',
  secrets_enc JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, plugin_id)
);
