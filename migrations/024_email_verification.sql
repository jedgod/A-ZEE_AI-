-- Email verification and password reset for end-user accounts.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

-- Accounts that existed before verification was introduced are trusted as they are.
UPDATE users SET email_verified_at = now() WHERE email_verified_at IS NULL;

CREATE TABLE IF NOT EXISTS user_email_tokens (
  token_hash TEXT PRIMARY KEY,                       -- sha256 of the emailed token; the token is never stored
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify', 'reset')),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_email_tokens_user ON user_email_tokens(user_id, purpose);
