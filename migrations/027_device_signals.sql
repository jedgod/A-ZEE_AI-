-- Free-tier abuse prevention: device signals, free-quota exhaustion, and per-account flags.
-- Signals are kept 90 days (purged by the renewal job) and only ever used for soft limits:
-- an upgrade wall on the free plan, with an admin allow list for false positives.

CREATE TABLE IF NOT EXISTS device_signals (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  ip_address INET,                                   -- NULL unless the request came through a trusted proxy path
  user_agent TEXT CHECK (user_agent IS NULL OR length(user_agent) <= 300),
  device_type TEXT CHECK (device_type IN ('desktop', 'mobile', 'tablet')),
  fingerprint TEXT CHECK (fingerprint IS NULL OR fingerprint ~ '^[a-f0-9]{64}$'),
  cookie_id TEXT CHECK (cookie_id IS NULL OR cookie_id ~ '^[a-f0-9]{32}$'),  -- issued by the server, HttpOnly
  action TEXT NOT NULL CHECK (action IN ('signup', 'login', 'free_usage')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_device_signals_user ON device_signals(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_device_signals_cookie ON device_signals(cookie_id) WHERE cookie_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_device_signals_fp ON device_signals(fingerprint) WHERE fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_device_signals_created ON device_signals(created_at);

CREATE TABLE IF NOT EXISTS free_quota_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature TEXT,
  exhausted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_free_quota_user ON free_quota_events(user_id, exhausted_at DESC);

CREATE TABLE IF NOT EXISTS abuse_flags (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  walled BOOLEAN NOT NULL DEFAULT false,             -- free plan shows the upgrade wall
  linked_accounts INTEGER NOT NULL DEFAULT 0,
  exhausted_linked INTEGER NOT NULL DEFAULT 0,
  allowed BOOLEAN NOT NULL DEFAULT false,            -- an administrator cleared this account
  note TEXT CHECK (note IS NULL OR length(note) <= 300),
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_abuse_flags_walled ON abuse_flags(walled, linked_accounts DESC);
