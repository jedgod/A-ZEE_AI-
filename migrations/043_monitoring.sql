-- "Monitor this for me": price and 24-hour-change rules, a once-per-day alert log, and device push tokens.
-- User ids in this project are TEXT (users.id), so every user_id here is TEXT too.

CREATE TABLE IF NOT EXISTS monitor_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL CHECK (symbol ~ '^[A-Z0-9][A-Z0-9._/=-]{0,19}$'),
  asset_class TEXT NOT NULL CHECK (asset_class IN ('stocks_etfs', 'crypto', 'forex', 'commodities')),
  rule_type TEXT NOT NULL CHECK (rule_type IN ('pct_drop_24h', 'pct_rise_24h', 'price_below', 'price_above')),
  threshold NUMERIC(18, 6) NOT NULL CHECK (threshold > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'triggered', 'paused', 'stale_feed')),
  last_checked_at TIMESTAMPTZ,
  last_price NUMERIC(24, 8),
  last_change_pct NUMERIC(12, 4),
  last_source TEXT,
  stale_reason TEXT CHECK (stale_reason IS NULL OR length(stale_reason) <= 300),
  triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_monitor_rules_user ON monitor_rules(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_monitor_rules_poll ON monitor_rules(last_checked_at NULLS FIRST) WHERE status IN ('active', 'stale_feed');

-- One row per alert. trigger_key = "<rule id>:<UTC day>" is UNIQUE, so a restart, a retry or two workers can never
-- alert the same rule twice in a day.
CREATE TABLE IF NOT EXISTS alert_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id UUID NOT NULL REFERENCES monitor_rules(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trigger_key TEXT NOT NULL UNIQUE,
  symbol TEXT NOT NULL,
  message TEXT NOT NULL CHECK (length(message) <= 500),
  observed_price NUMERIC(24, 8) NOT NULL,
  source TEXT NOT NULL,
  push_sent BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_alert_events_user ON alert_events(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expo_push_token TEXT NOT NULL UNIQUE CHECK (length(expo_push_token) <= 200),
  platform TEXT NOT NULL DEFAULT 'android' CHECK (platform IN ('android', 'ios')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON user_push_tokens(user_id);
