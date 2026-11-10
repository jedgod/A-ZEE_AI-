-- Migration 001: add idempotency support to paper orders
-- Safe to run multiple times.

ALTER TABLE paper_orders
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_paper_orders_idempotency
  ON paper_orders (account_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Optional: freshness helper view
CREATE OR REPLACE VIEW market_prices_fresh AS
SELECT *,
       (now() - updated_at) AS age
FROM market_prices;
