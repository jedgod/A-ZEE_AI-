-- Charging saved payment methods: a ledger of Stripe charges, and cancel-at-period-end.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id TEXT REFERENCES subscriptions(id) ON DELETE SET NULL,
  plan_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('signup', 'renewal')),
  billing TEXT NOT NULL CHECK (billing IN ('monthly', 'annual')),
  provider_payment_intent_id TEXT NOT NULL UNIQUE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'usd',
  status TEXT NOT NULL CHECK (status IN ('processing', 'succeeded', 'failed')),
  failure_code TEXT CHECK (failure_code IS NULL OR length(failure_code) <= 60),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscriptions_renewal ON subscriptions(current_period_end) WHERE status = 'active' AND provider = 'stripe';
