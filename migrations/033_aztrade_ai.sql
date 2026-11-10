-- AZTrade assistant: its own monthly allowance, separate from chat (usage_counters) and from the AZLinqext keyboard
-- (linqext_usage), and a request ledger so a retried bridge call is answered once and charged once.
CREATE TABLE IF NOT EXISTS aztrade_ai_usage (
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  used         INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
  PRIMARY KEY (user_id, period_start)
);

CREATE TABLE IF NOT EXISTS aztrade_ai_requests (
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id     UUID NOT NULL,
  payload_hash   TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  response       JSONB,
  charged_period DATE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, request_id)
);
CREATE INDEX IF NOT EXISTS aztrade_ai_requests_recent ON aztrade_ai_requests (user_id, created_at DESC);
