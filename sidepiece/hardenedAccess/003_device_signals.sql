-- Anti multi-account signals (PostgreSQL)
-- For SQLite: change INET to TEXT, remove ::inet casts, and use TEXT for timestamps if needed.

CREATE TABLE IF NOT EXISTS device_signals (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id       TEXT,
  ip_address    INET,
  user_agent    TEXT,
  device_type   TEXT,          -- desktop / mobile / tablet
  fingerprint   TEXT,
  cookie_id     TEXT,
  action        TEXT,          -- signup | free_usage | login
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_device_signals_fp ON device_signals(fingerprint);
CREATE INDEX IF NOT EXISTS idx_device_signals_ip ON device_signals(ip_address);
CREATE INDEX IF NOT EXISTS idx_device_signals_user ON device_signals(user_id);
CREATE INDEX IF NOT EXISTS idx_device_signals_cookie ON device_signals(cookie_id);
CREATE INDEX IF NOT EXISTS idx_device_signals_created ON device_signals(created_at);

-- Optional: track free quota exhaustion
CREATE TABLE IF NOT EXISTS free_quota_events (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id       TEXT NOT NULL,
  exhausted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  signal_id     TEXT REFERENCES device_signals(id)
);

CREATE INDEX IF NOT EXISTS idx_free_quota_user ON free_quota_events(user_id);
