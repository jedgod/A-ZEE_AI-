-- Plans, subscriptions, and usage limits (PostgreSQL 18).

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_price_usd NUMERIC NOT NULL CHECK (base_price_usd >= 0),
  interval TEXT NOT NULL CHECK (interval IN ('month', 'user/month', 'custom')),
  features JSONB,
  is_active BOOLEAN DEFAULT true,
  -- Additions: yearly price (NULL = no annual option), card copy, ordering.
  annual_price_usd NUMERIC CHECK (annual_price_usd >= 0),
  best_for TEXT,
  popular BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT REFERENCES plans(id),
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'pending', 'canceled', 'expired')),
  region TEXT CHECK (region ~ '^[A-Z]{2}$'),
  price_paid NUMERIC CHECK (price_paid >= 0),
  currency TEXT DEFAULT 'USD',
  started_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  ends_at TIMESTAMPTZ,
  billing TEXT NOT NULL DEFAULT 'monthly' CHECK (billing IN ('monthly', 'annual'))
);
-- At most one active and one pending subscription per user.
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_one_active ON subscriptions (user_id) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_one_pending ON subscriptions (user_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS usage_limits (
  plan_id TEXT REFERENCES plans(id) ON DELETE CASCADE,
  feature TEXT CHECK (feature IN ('messages', 'reasoning', 'research')),
  monthly_limit INTEGER CHECK (monthly_limit >= 0), -- NULL = unlimited
  PRIMARY KEY (plan_id, feature)
);

-- Seed plans (prices from components/pricing-plans.tsx). Features describe what AZ_AI provides.
-- Annual prices are two months free (10 x monthly); adjust before selling.
INSERT INTO plans (id, name, base_price_usd, interval, annual_price_usd, best_for, popular, sort_order, features) VALUES
 ('free', 'Free', 0, 'month', NULL, 'Basic everyday use', false, 10,
  '["Chat, code, and research modes", "Standard models", "History and projects in your browser"]'),
 ('go', 'Go', 5, 'month', 50, 'More access at a lower cost', false, 20,
  '["Higher message limits", "Answer feedback and corrections", "Support requests"]'),
 ('plus', 'Plus', 14.99, 'month', 149.90, 'Research, coding, teaching, and productivity', true, 30,
  '["AZ · Reasoning (multi-pass answers)", "Explore deeply with research plans", "Development canvas previews", "Personalization", "File attachments"]'),
 ('pro100', 'Pro 100', 25, 'month', 250, 'Heavy research and development', false, 40,
  '["Much higher reasoning and research limits", "AZee Connect for VS Code and other editors", "Higher code-mode limits"]'),
 ('pro200', 'Pro 200', 60, 'month', 600, 'More intensive AI workflows', false, 50,
  '["Higher Pro limits", "Longer conversations kept in context", "Everything in Pro 100"]'),
 ('pro500', 'Pro 500', 250, 'month', 2500, 'Highest individual usage tier', false, 60,
  '["Unlimited messages, reasoning, and research", "Everything in Pro 200"]'),
 ('business', 'Business Standard', 14.99, 'user/month', 149.90, 'Teams and organizations', false, 70,
  '["Operations workspace for your team", "Shared prompts", "Admin controls"]'),
 ('business-premium', 'Business Premium', 25, 'user/month', 250, 'Teams needing higher allowances', false, 80,
  '["Higher team limits", "Advanced admin controls", "Approval workflows"]'),
 ('enterprise', 'Enterprise', 0, 'custom', NULL, 'Large organizations', false, 90,
  '["Custom limits", "Dedicated support", "Service-level agreement", "Single sign-on"]')
ON CONFLICT (id) DO NOTHING;

-- Monthly allowances per plan (placeholder numbers; adjust to your costs). NULL = unlimited.
INSERT INTO usage_limits (plan_id, feature, monthly_limit) VALUES
 ('free', 'messages', 300), ('free', 'reasoning', 20), ('free', 'research', 30),
 ('go', 'messages', 1500), ('go', 'reasoning', 100), ('go', 'research', 150),
 ('plus', 'messages', 5000), ('plus', 'reasoning', 500), ('plus', 'research', 500),
 ('pro100', 'messages', 15000), ('pro100', 'reasoning', 2000), ('pro100', 'research', 2000),
 ('pro200', 'messages', 40000), ('pro200', 'reasoning', 6000), ('pro200', 'research', 6000),
 ('pro500', 'messages', NULL), ('pro500', 'reasoning', NULL), ('pro500', 'research', NULL),
 ('business', 'messages', 5000), ('business', 'reasoning', 500), ('business', 'research', 500),
 ('business-premium', 'messages', 15000), ('business-premium', 'reasoning', 2000), ('business-premium', 'research', 2000),
 ('enterprise', 'messages', NULL), ('enterprise', 'reasoning', NULL), ('enterprise', 'research', NULL)
ON CONFLICT (plan_id, feature) DO NOTHING;

-- The account's current plan now refers to the plans table (was a fixed free/plus/pro list).
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_plan_check;
UPDATE users SET plan = 'pro100' WHERE plan = 'pro';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_plan_fkey') THEN
    ALTER TABLE users ADD CONSTRAINT users_plan_fkey FOREIGN KEY (plan) REFERENCES plans(id);
  END IF;
END $$;
ALTER TABLE users ADD COLUMN IF NOT EXISTS region TEXT CHECK (region ~ '^[A-Z]{2}$');

-- Existing accounts get an active subscription matching their current plan (granted, not paid).
INSERT INTO subscriptions (id, user_id, plan_id, status, price_paid)
SELECT gen_random_uuid()::text, u.id, u.plan, 'active', NULL FROM users u
WHERE NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id AND s.status = 'active');
