-- AZTrade v3: additive financial guards. Apply to disposable PostgreSQL first.
-- This is NOT a complete balanced ledger or production RLS migration.
BEGIN;
ALTER TABLE paper_orders ALTER COLUMN idempotency_key SET NOT NULL;
ALTER TABLE paper_orders ALTER COLUMN request_hash SET NOT NULL;
ALTER TABLE paper_orders ADD CONSTRAINT paper_orders_idempotency_nonempty
  CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 128);
ALTER TABLE paper_orders ADD CONSTRAINT paper_orders_hash_sha256
  CHECK (request_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE market_prices ADD CONSTRAINT market_prices_positive_price CHECK (price > 0);
ALTER TABLE market_prices ADD CONSTRAINT market_prices_not_future
  CHECK (updated_at <= now() + interval '60 seconds') NOT VALID;
-- NOT VALID deliberately: preexisting rows need a data-cleanup and VALIDATE step.
-- Prevent destructive or mutable ledger edits at the database layer.
CREATE OR REPLACE FUNCTION reject_paper_ledger_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'paper_ledger is append-only';
END $$;
DROP TRIGGER IF EXISTS paper_ledger_append_only ON paper_ledger;
CREATE TRIGGER paper_ledger_append_only
BEFORE UPDATE OR DELETE OR TRUNCATE ON paper_ledger
FOR EACH STATEMENT EXECUTE FUNCTION reject_paper_ledger_mutation();
-- Preserve ledger history even if a paper account is removed.
ALTER TABLE paper_ledger DROP CONSTRAINT IF EXISTS paper_ledger_account_id_fkey;
ALTER TABLE paper_ledger ADD CONSTRAINT paper_ledger_account_id_fkey
  FOREIGN KEY (account_id) REFERENCES paper_accounts(id) ON DELETE RESTRICT;
COMMIT;
