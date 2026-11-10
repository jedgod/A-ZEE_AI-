-- Migration 002: immutable paper ledger + request binding for idempotency

CREATE TABLE IF NOT EXISTS paper_ledger (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id    UUID NOT NULL REFERENCES paper_accounts(id) ON DELETE CASCADE,
  order_id      UUID REFERENCES paper_orders(id),
  entry_type    TEXT NOT NULL CHECK (entry_type IN ('debit','credit')),
  account_code  TEXT NOT NULL,          -- e.g. 'cash', 'position:AAPL'
  amount        NUMERIC(18,8) NOT NULL CHECK (amount > 0),
  symbol        TEXT,
  shares        NUMERIC(18,8),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_paper_ledger_account ON paper_ledger(account_id, created_at);

ALTER TABLE paper_orders
  ADD COLUMN IF NOT EXISTS request_hash TEXT;

-- Optional tenant column for future RLS
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS tenant_id TEXT;

CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
