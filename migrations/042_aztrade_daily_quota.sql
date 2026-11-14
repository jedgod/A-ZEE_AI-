-- 042: AZTrade daily quotas (backtest runs, AI research questions), separate from ordinary A-Zee chat allowances.
-- A reservation is one row per request, so a retried request is never charged twice and a failed one can be refunded once.
CREATE TABLE IF NOT EXISTS aztrade_daily_usage (
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature TEXT NOT NULL CHECK (feature IN ('backtest', 'research')),
  day DATE NOT NULL,
  used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
  PRIMARY KEY (owner_id, feature, day)
);
CREATE TABLE IF NOT EXISTS aztrade_quota_events (
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature TEXT NOT NULL CHECK (feature IN ('backtest', 'research')),
  request_id UUID NOT NULL,
  day DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('reserved', 'refunded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, feature, request_id)
);
CREATE INDEX IF NOT EXISTS aztrade_quota_events_age ON aztrade_quota_events(created_at);
