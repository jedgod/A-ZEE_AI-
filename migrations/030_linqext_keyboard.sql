-- AZLinqext keyboard credentials and consent.
--
-- A keyboard "link" is a narrowly scoped credential for the Android keyboard: a 15-minute access
-- token and a rotating refresh token, accepted only by /api/linqext/*. A link is tied to the app
-- session that created it (parent_session_hash): when that session is signed out, revoked or
-- expired, or the account is deleted, the link stops working. Only SHA-256 hashes are stored.
CREATE TABLE IF NOT EXISTS linqext_keyboard_links (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_session_hash TEXT NOT NULL,
  device_id TEXT,
  refresh_hash TEXT NOT NULL UNIQUE,
  prev_refresh_hash TEXT,
  rotated_at TIMESTAMPTZ,
  access_hash TEXT UNIQUE,
  access_expires_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS linqext_keyboard_links_user ON linqext_keyboard_links (user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS linqext_keyboard_links_parent ON linqext_keyboard_links (parent_session_hash);
CREATE INDEX IF NOT EXISTS linqext_keyboard_links_prev ON linqext_keyboard_links (prev_refresh_hash) WHERE prev_refresh_hash IS NOT NULL;

-- What the user agreed to for reply assist. The server refuses to process a message without it,
-- and drops earlier-message context unless that was agreed separately. `version` lets a change in
-- what is sent require fresh consent. Deleted with the account.
CREATE TABLE IF NOT EXISTS linqext_consents (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  reply_assist BOOLEAN NOT NULL DEFAULT false,
  context BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
