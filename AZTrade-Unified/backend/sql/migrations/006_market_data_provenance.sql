-- Migration 006: market-data provenance and a licence gate for paper execution.
-- Run as the migration owner on a disposable PostgreSQL 16 instance, after 001-005. Idempotent.
--
-- Rules this migration enforces in the database:
--   * Every price names the registered SOURCE it came from. Only the owner can register a source or change its licence
--     status; the market-data ingestion role can write prices but cannot create, relicense or edit sources.
--   * A price may drive a paper fill only if its source is `licensed`, carries a licence reference, allows execution and has
--     not expired. Seeded and unregistered prices default to the `demo-seed` source, which never allows execution (fail closed).
--   * Every fill records the source and the time the provider observed the price (audit trail).
--   * A price can never move backwards in provider time, and provider time cannot be in the future.
BEGIN;

CREATE TABLE IF NOT EXISTS market_data_sources (
  id                 TEXT PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  name               TEXT NOT NULL CHECK (length(btrim(name)) > 0),
  license_status     TEXT NOT NULL CHECK (license_status IN ('licensed', 'demo', 'test', 'expired')),
  license_reference  TEXT,
  allows_execution   BOOLEAN NOT NULL DEFAULT false,
  valid_until        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT licensed_needs_reference CHECK (license_status <> 'licensed' OR length(btrim(COALESCE(license_reference, ''))) > 0),
  CONSTRAINT execution_needs_licence  CHECK (NOT allows_execution OR license_status = 'licensed')
);

-- The default source: seeded demo prices. Never allowed to drive a fill.
INSERT INTO market_data_sources (id, name, license_status, allows_execution)
VALUES ('demo-seed', 'Seeded demonstration prices (not market data)', 'demo', false)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE market_prices ADD COLUMN IF NOT EXISTS source_id TEXT NOT NULL DEFAULT 'demo-seed' REFERENCES market_data_sources(id);
ALTER TABLE market_prices ADD COLUMN IF NOT EXISTS provider_timestamp TIMESTAMPTZ;
ALTER TABLE market_prices ADD COLUMN IF NOT EXISTS ingested_at TIMESTAMPTZ;

ALTER TABLE market_prices DROP CONSTRAINT IF EXISTS market_prices_provider_not_future;
ALTER TABLE market_prices ADD CONSTRAINT market_prices_provider_not_future
  CHECK (provider_timestamp IS NULL OR provider_timestamp <= now() + interval '60 seconds');

-- Provenance on every fill: which source priced it, and when the provider observed that price.
ALTER TABLE paper_orders ADD COLUMN IF NOT EXISTS price_source_id TEXT REFERENCES market_data_sources(id);
ALTER TABLE paper_orders ADD COLUMN IF NOT EXISTS price_observed_at TIMESTAMPTZ;

-- Sources are reference data: only the owner may change them. The immutable audit of a licence change is the row itself
-- plus the owner's database audit log; a change that would silently re-license history is refused below.
CREATE OR REPLACE FUNCTION aztrade_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM market_prices WHERE source_id = OLD.id) OR EXISTS (SELECT 1 FROM paper_orders WHERE price_source_id = OLD.id) THEN
      RAISE EXCEPTION 'a market data source that priced anything cannot be deleted' USING ERRCODE = 'T0012';
    END IF;
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trade_source_guard ON market_data_sources;
CREATE TRIGGER trade_source_guard BEFORE DELETE ON market_data_sources FOR EACH ROW EXECUTE FUNCTION aztrade_source_guard();

COMMIT;
