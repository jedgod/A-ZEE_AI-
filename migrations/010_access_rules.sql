-- Subscription access rules (from subscription-access-rule/sql/schema.sql), merged into the
-- existing plans/subscriptions tables instead of redefining them.

-- Per-plan feature entitlements: enabled flag + monthly limit (NULL = unlimited).
CREATE TABLE IF NOT EXISTS plan_entitlements (
  plan_id TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  feature TEXT NOT NULL CHECK (feature ~ '^[a-z][a-z0-9_]{1,40}$'),
  enabled BOOLEAN NOT NULL DEFAULT false,
  monthly_limit INTEGER CHECK (monthly_limit IS NULL OR monthly_limit >= 0),
  PRIMARY KEY (plan_id, feature)
);

-- Metered features keep the allowances already configured in usage_limits.
INSERT INTO plan_entitlements (plan_id, feature, enabled, monthly_limit)
SELECT plan_id, feature, true, monthly_limit FROM usage_limits
ON CONFLICT (plan_id, feature) DO NOTHING;

-- On/off features (what the pricing page promises). Plus and above include research plans,
-- personalization, and file attachments; translation is available on every plan.
INSERT INTO plan_entitlements (plan_id, feature, enabled, monthly_limit)
SELECT p.id, f.feature, p.id NOT IN ('free', 'go') OR f.feature = 'translation', NULL
FROM plans p CROSS JOIN (VALUES ('research_plans'), ('personalization'), ('attachments'), ('translation')) AS f(feature)
ON CONFLICT (plan_id, feature) DO NOTHING;

-- usage_limits stays readable (and updatable) as a view over the single source of truth.
DROP TABLE IF EXISTS usage_limits;
CREATE VIEW usage_limits AS
  SELECT plan_id, feature, monthly_limit FROM plan_entitlements
  WHERE feature IN ('messages', 'reasoning', 'research') AND enabled;

-- Subscriptions: provider fields, billing periods, trialing/past_due statuses.
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_status_check
  CHECK (status IN ('active', 'trialing', 'past_due', 'pending', 'canceled', 'expired'));
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS provider_subscription_id TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS provider_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
DROP INDEX IF EXISTS subscriptions_one_active;
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_one_current ON subscriptions (user_id)
  WHERE status IN ('active', 'trialing', 'past_due');

-- Monthly usage counters, incremented atomically when a request is admitted.
-- subject = 'account:<users.id>' for the local account or 'guest:<browser id>'.
CREATE TABLE IF NOT EXISTS usage_counters (
  subject TEXT NOT NULL CHECK (length(subject) <= 80),
  feature TEXT NOT NULL,
  period_start DATE NOT NULL,
  used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0),
  PRIMARY KEY (subject, feature, period_start)
);

-- Entitlement denials (upgrade_required / quota_exceeded); no request content.
CREATE TABLE IF NOT EXISTS access_audit (
  id BIGSERIAL PRIMARY KEY,
  subject TEXT,
  feature TEXT,
  decision TEXT NOT NULL CHECK (decision IN ('allowed', 'upgrade_required', 'quota_exceeded')),
  plan_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS access_audit_recent ON access_audit (created_at DESC);

-- Billing webhook idempotency: each provider event is applied once.
CREATE TABLE IF NOT EXISTS billing_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
