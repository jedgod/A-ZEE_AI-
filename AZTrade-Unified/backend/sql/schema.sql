-- AZTrade AI — PostgreSQL Schema
-- Production-ready financial engine schema
-- Run with: psql $DATABASE_URL -f schema.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users (maps to A-Zee identity)
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  azee_user_id  TEXT UNIQUE NOT NULL,
  email         TEXT,
  tier          TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free','plus','premium')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Market instruments (reference data)
CREATE TABLE instruments (
  symbol        TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('stock','etf','crypto','forex')),
  sector        TEXT,
  currency      TEXT NOT NULL DEFAULT 'USD',
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Latest market prices (upserted by feed or mock updater)
CREATE TABLE market_prices (
  symbol        TEXT PRIMARY KEY REFERENCES instruments(symbol),
  price         NUMERIC(18,8) NOT NULL,
  change_abs    NUMERIC(18,8),
  change_pct    NUMERIC(10,4),
  rsi           NUMERIC(6,2),
  volume        BIGINT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- User portfolios (can support multiple per user later)
CREATE TABLE portfolios (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL DEFAULT 'Main',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

-- Holdings
CREATE TABLE holdings (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  portfolio_id  UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  symbol        TEXT NOT NULL REFERENCES instruments(symbol),
  shares        NUMERIC(18,8) NOT NULL CHECK (shares > 0),
  avg_cost      NUMERIC(18,8) NOT NULL CHECK (avg_cost >= 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (portfolio_id, symbol)
);

-- Paper trading accounts (virtual ledger)
CREATE TABLE paper_accounts (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  cash          NUMERIC(18,8) NOT NULL DEFAULT 100000 CHECK (cash >= 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Paper positions
CREATE TABLE paper_positions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id    UUID NOT NULL REFERENCES paper_accounts(id) ON DELETE CASCADE,
  symbol        TEXT NOT NULL REFERENCES instruments(symbol),
  shares        NUMERIC(18,8) NOT NULL CHECK (shares > 0),
  entry_price   NUMERIC(18,8) NOT NULL,
  opened_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, symbol)
);

-- Paper orders / history
CREATE TABLE paper_orders (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id      UUID NOT NULL REFERENCES paper_accounts(id) ON DELETE CASCADE,
  symbol          TEXT NOT NULL,
  side            TEXT NOT NULL CHECK (side IN ('BUY','SELL')),
  shares          NUMERIC(18,8) NOT NULL CHECK (shares > 0),
  price           NUMERIC(18,8) NOT NULL CHECK (price > 0),
  status          TEXT NOT NULL DEFAULT 'filled' CHECK (status IN ('filled','rejected')),
  idempotency_key TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_paper_orders_idempotency
  ON paper_orders (account_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Risk alerts
CREATE TABLE alerts (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message       TEXT NOT NULL,
  severity      TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- AI assistant conversations (optional persistence)
CREATE TABLE assistant_messages (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role          TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content       TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_holdings_portfolio ON holdings(portfolio_id);
CREATE INDEX idx_paper_positions_account ON paper_positions(account_id);
CREATE INDEX idx_paper_orders_account ON paper_orders(account_id);
CREATE INDEX idx_alerts_user ON alerts(user_id) WHERE active = true;
CREATE INDEX idx_assistant_user ON assistant_messages(user_id, created_at DESC);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_holdings_updated BEFORE UPDATE ON holdings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_paper_accounts_updated BEFORE UPDATE ON paper_accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
