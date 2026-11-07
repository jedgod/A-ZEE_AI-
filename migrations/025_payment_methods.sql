-- Saved payment methods. Card and bank details NEVER touch this server or database: the browser
-- sends them straight to Stripe, which returns a token (pm_...). We keep only that token and the
-- non-sensitive display details Stripe reports back (brand, last four digits, expiry, account type).

CREATE TABLE IF NOT EXISTS payment_customers (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'stripe',
  provider_customer_id TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_payment_method_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('card', 'bank_account')),
  brand TEXT CHECK (brand IS NULL OR length(brand) <= 40),          -- card brand, or the bank's name
  funding TEXT CHECK (funding IS NULL OR funding IN ('debit', 'credit', 'prepaid', 'unknown')),
  account_type TEXT CHECK (account_type IS NULL OR account_type IN ('checking', 'savings')),
  last4 TEXT NOT NULL CHECK (last4 ~ '^[0-9]{4}$'),
  exp_month INTEGER CHECK (exp_month IS NULL OR exp_month BETWEEN 1 AND 12),
  exp_year INTEGER CHECK (exp_year IS NULL OR exp_year BETWEEN 2000 AND 2200),
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payment_methods_user ON payment_methods(user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS payment_methods_one_default ON payment_methods(user_id) WHERE is_default;
