-- sql/schema.sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plans (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  description text,
  base_price_usd numeric(10,2),
  interval text DEFAULT 'month',
  active boolean NOT NULL DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plan_entitlements (
  plan_id text NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  feature text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  monthly_limit integer CHECK (monthly_limit IS NULL OR monthly_limit >= 0),
  PRIMARY KEY (plan_id, feature)
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id text NOT NULL REFERENCES plans(id),
  status text NOT NULL CHECK (status IN ('pending', 'active', 'trialing', 'past_due', 'canceled', 'expired')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  provider text,
  provider_subscription_id text UNIQUE,
  provider_customer_id text,
  metadata jsonb DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS one_current_subscription
  ON subscriptions(user_id)
  WHERE status IN ('active', 'trialing', 'past_due');

CREATE TABLE IF NOT EXISTS usage_counters (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  feature text NOT NULL,
  period_start date NOT NULL,
  used integer NOT NULL DEFAULT 0 CHECK (used >= 0),
  PRIMARY KEY (user_id, feature, period_start)
);

CREATE TABLE IF NOT EXISTS access_audit (
  id bigserial PRIMARY KEY,
  user_id uuid,
  feature text,
  decision text,
  plan_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO plans (id, display_name, description, base_price_usd, interval, sort_order) VALUES
  ('free', 'Free', 'Basic everyday use', 0, 'month', 1),
  ('go', 'Go', 'More access at a lower cost', 5, 'month', 2),
  ('plus', 'Plus', 'Research, coding, teaching, and productivity', 14.99, 'month', 3),
  ('pro', 'Pro', 'Heavy research and development', 25, 'month', 4),
  ('business', 'Business', 'Teams and organizations', 14.99, 'user/month', 5),
  ('enterprise', 'Enterprise', 'Large organizations — custom pricing', NULL, 'custom', 6)
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  base_price_usd = EXCLUDED.base_price_usd,
  interval = EXCLUDED.interval,
  sort_order = EXCLUDED.sort_order;

INSERT INTO plan_entitlements (plan_id, feature, enabled, monthly_limit) VALUES
  ('free', 'basic_articles', true, NULL),
  ('free', 'premium_articles', false, NULL),
  ('free', 'ai_reports', true, 5),
  ('go', 'basic_articles', true, NULL),
  ('go', 'premium_articles', false, NULL),
  ('go', 'ai_reports', true, 20),
  ('plus', 'basic_articles', true, NULL),
  ('plus', 'premium_articles', true, NULL),
  ('plus', 'ai_reports', true, 100),
  ('pro', 'basic_articles', true, NULL),
  ('pro', 'premium_articles', true, NULL),
  ('pro', 'ai_reports', true, 1000),
  ('business', 'basic_articles', true, NULL),
  ('business', 'premium_articles', true, NULL),
  ('business', 'ai_reports', true, 500),
  ('enterprise', 'basic_articles', true, NULL),
  ('enterprise', 'premium_articles', true, NULL),
  ('enterprise', 'ai_reports', true, NULL)
ON CONFLICT (plan_id, feature) DO UPDATE SET
  enabled = EXCLUDED.enabled,
  monthly_limit = EXCLUDED.monthly_limit;
