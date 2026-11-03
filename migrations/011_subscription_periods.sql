-- Columns used by the admin "Awaiting payment" endpoints (subscription-access-rule/src/server.ts).
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS current_period_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
UPDATE subscriptions SET created_at = coalesce(started_at, now()) WHERE created_at IS NULL;
ALTER TABLE subscriptions ALTER COLUMN created_at SET DEFAULT now(), ALTER COLUMN created_at SET NOT NULL;
