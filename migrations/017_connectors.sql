-- 017: GitHub and Google Drive connectors (OAuth, read-only).
-- Tokens are stored encrypted (AES-256-GCM, key in CONNECTOR_TOKEN_KEY); they never reach the
-- browser. OAuth states are single-use and expire. Every connector action is audited.

CREATE TABLE IF NOT EXISTS connector_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('github', 'google_drive')),
  external_id TEXT NOT NULL CHECK (length(external_id) <= 200),
  external_login TEXT NOT NULL CHECK (length(external_login) <= 320),
  scopes TEXT[] NOT NULL DEFAULT '{}',
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, provider)
);

CREATE TABLE IF NOT EXISTS connector_oauth_states (
  state_hash TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('github', 'google_drive')),
  verifier_enc TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS connector_oauth_states_expiry ON connector_oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS connector_audit (
  id BIGSERIAL PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  action TEXT NOT NULL CHECK (length(action) <= 40),
  resource TEXT CHECK (resource IS NULL OR length(resource) <= 500),
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'denied')),
  detail TEXT CHECK (detail IS NULL OR length(detail) <= 300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS connector_audit_owner ON connector_audit(owner_id, created_at DESC);
