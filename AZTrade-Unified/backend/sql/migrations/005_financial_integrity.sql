-- Financial invariants for a paper-only simulation. Run on disposable PG first.
BEGIN;
ALTER TABLE paper_orders ADD CONSTRAINT paper_orders_positive_price CHECK (price > 0);
ALTER TABLE paper_positions ADD CONSTRAINT paper_positions_positive_entry CHECK (entry_price > 0);
-- One posting pair per filled order: the deferred trigger sees both entries at COMMIT.
CREATE OR REPLACE FUNCTION aztrade_check_paper_posting() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n int; deb numeric; cred numeric;
BEGIN
 SELECT count(*), coalesce(sum(amount) FILTER (WHERE entry_type='debit'),0),
 coalesce(sum(amount) FILTER (WHERE entry_type='credit'),0)
 INTO n,deb,cred FROM paper_ledger WHERE order_id=NEW.order_id;
 IF n<>2 OR deb<>cred THEN RAISE EXCEPTION 'Unbalanced paper posting for order %', NEW.order_id; END IF;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trade_posting_balanced ON paper_ledger;
CREATE CONSTRAINT TRIGGER trade_posting_balanced AFTER INSERT ON paper_ledger
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION aztrade_check_paper_posting();
-- Ledger history must survive account deletion, enforced by 003 RESTRICT FK.
-- Remove destructive cascading order history (ledger order_id FK prevents deletion once posted).
ALTER TABLE paper_orders DROP CONSTRAINT IF EXISTS paper_orders_account_id_fkey;
ALTER TABLE paper_orders ADD CONSTRAINT paper_orders_account_id_fkey
 FOREIGN KEY (account_id) REFERENCES paper_accounts(id) ON DELETE RESTRICT;
COMMIT;
