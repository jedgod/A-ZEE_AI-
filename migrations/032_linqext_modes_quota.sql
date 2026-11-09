-- AZLinqext texting assistant: modes, and a usage allowance of its own so keyboard requests never
-- consume the Main AI Page's chat quota (usage_counters). One row per user per UTC month.
CREATE TABLE IF NOT EXISTS linqext_usage (
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  used         INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
  PRIMARY KEY (user_id, period_start)
);

-- Which mode a request used, and the period it was charged to. charged_period is set in the same
-- transaction as the charge, so a retry or a takeover of a stale request is never charged twice,
-- and a failed request refunds exactly the period it was charged to.
ALTER TABLE linqext_requests ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'reply'
  CHECK (mode IN ('reply', 'rewrite', 'grammar', 'tone', 'translate', 'summarize'));
ALTER TABLE linqext_requests ADD COLUMN IF NOT EXISTS charged_period DATE;
