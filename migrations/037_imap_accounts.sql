-- 037: Yahoo and iCloud mail over IMAP. These providers have no OAuth for mail, so the user gives an
-- app-specific password. The email and password are stored together as one sealed value (AES-256-GCM, the
-- connector key in CONNECTOR_TOKEN_KEY); only the email address is kept in the clear, to show which
-- account is connected. Disconnecting deletes the row, and with it the credentials.
CREATE TABLE IF NOT EXISTS imap_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('yahoo', 'icloud')),
  email TEXT NOT NULL CHECK (char_length(email) <= 254),
  credentials_enc TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, provider)
);
