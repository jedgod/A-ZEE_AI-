-- Migration 007: PostgreSQL-owned paper order posting, immutable opening balance, reconciliation.
-- Run as the migration owner on a disposable PostgreSQL 16 instance, after 001-006 (006 provides market-data provenance).
-- Idempotent: safe to run twice.
--
-- Why this exists (CERTIFICATION_NEXT_STEPS.md, task 3 and 4):
--   * Orders are posted by ONE database procedure: account row lock, idempotency replay, quote check,
--     NUMERIC-only arithmetic with a single rounding shared by cash and ledger, position update, order
--     row and a balanced two-entry ledger posting, all in the caller's transaction.
--   * The application role is not given write access to cash, positions, orders or the ledger. It can only
--     call the procedure, so a bug or injection in the API cannot move money outside a balanced posting.
--   * An account's cash must be explainable from its opening balance plus its ledger, and its positions
--     from its fills. aztrade_reconcile_paper_account() returns one row per violation (no rows = pass).
BEGIN;

-- ---------------------------------------------------------------------------------------------
-- 1. Opening balance: recorded once, never changed.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE paper_accounts ADD COLUMN IF NOT EXISTS opening_cash NUMERIC(18,8);

-- Accounts that already exist: their opening balance is what the current cash and the ledger imply.
-- (cash credits are buys that reduced cash; cash debits are sells that increased it.) For legacy rows this
-- is a derivation, not independent evidence; accounts created from now on record it at insert time.
UPDATE paper_accounts a SET opening_cash = a.cash
   + COALESCE((SELECT sum(l.amount) FROM paper_ledger l WHERE l.account_id = a.id AND l.account_code = 'cash' AND l.entry_type = 'credit'), 0)
   - COALESCE((SELECT sum(l.amount) FROM paper_ledger l WHERE l.account_id = a.id AND l.account_code = 'cash' AND l.entry_type = 'debit'), 0)
 WHERE a.opening_cash IS NULL;

ALTER TABLE paper_accounts ALTER COLUMN opening_cash SET NOT NULL;
ALTER TABLE paper_accounts DROP CONSTRAINT IF EXISTS paper_accounts_opening_cash_nonneg;
ALTER TABLE paper_accounts ADD CONSTRAINT paper_accounts_opening_cash_nonneg CHECK (opening_cash >= 0);

CREATE OR REPLACE FUNCTION aztrade_paper_account_opening() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.opening_cash IS NULL THEN NEW.opening_cash := NEW.cash; END IF;
    IF NEW.opening_cash <> NEW.cash THEN
      RAISE EXCEPTION 'a new paper account must start with cash equal to its opening balance' USING ERRCODE = 'T0010';
    END IF;
  ELSIF NEW.opening_cash IS DISTINCT FROM OLD.opening_cash THEN
    RAISE EXCEPTION 'paper_accounts.opening_cash is immutable' USING ERRCODE = 'T0011';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trade_paper_account_opening ON paper_accounts;
CREATE TRIGGER trade_paper_account_opening BEFORE INSERT OR UPDATE ON paper_accounts
  FOR EACH ROW EXECUTE FUNCTION aztrade_paper_account_opening();

-- ---------------------------------------------------------------------------------------------
-- 2. The order posting procedure.
--    SECURITY DEFINER: runs with the owner's table privileges so the application role needs none.
--    Row-level security still applies (FORCE RLS covers the owner) and uses the same transaction-local
--    identity, so a caller can only post to its own account. search_path is pinned.
--    Error codes (SQLSTATE class T0 is ours): T0001 identity, T0002 no account, T0003 idempotency
--    payload mismatch, T0004 unknown instrument, T0005 stale quote, T0006 insufficient cash,
--    T0007 insufficient position, T0008 invalid input, T0009 price source not licensed for execution.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION aztrade_place_paper_order(
  p_symbol text, p_side text, p_shares numeric, p_idempotency_key text, p_request_hash text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_user     uuid := aztrade_user_id();
  v_acct     paper_accounts%ROWTYPE;
  v_prior    paper_orders%ROWTYPE;
  v_price    numeric;
  v_quoted   timestamptz;
  v_source   text;
  v_src      market_data_sources%ROWTYPE;
  v_notional numeric;
  v_held     numeric;
  v_order    paper_orders%ROWTYPE;
  v_cash_type text;
  v_pos_type  text;
BEGIN
  IF v_user IS NULL OR aztrade_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'verified user and tenant context required' USING ERRCODE = 'T0001';
  END IF;
  IF p_symbol IS NULL OR p_symbol !~ '^[A-Z0-9._/-]{1,32}$'
     OR p_side NOT IN ('BUY', 'SELL')
     OR p_shares IS NULL OR p_shares <= 0 OR p_shares > 999999 OR scale(p_shares) > 8
     OR p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,128}$'
     OR p_request_hash IS NULL OR p_request_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'invalid order' USING ERRCODE = 'T0008';
  END IF;

  -- One lock per account serialises every order (and duplicate retry) for it. RLS limits this to the caller's account.
  SELECT * INTO v_acct FROM paper_accounts WHERE user_id = v_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no paper account' USING ERRCODE = 'T0002'; END IF;

  -- Idempotency: the same key replays the stored order; the same key with a different payload is refused.
  SELECT * INTO v_prior FROM paper_orders WHERE account_id = v_acct.id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_prior.request_hash <> p_request_hash THEN
      RAISE EXCEPTION 'idempotency key reused with a different payload' USING ERRCODE = 'T0003';
    END IF;
    RETURN jsonb_build_object('replay', true, 'order', to_jsonb(v_prior));
  END IF;

  -- The observation time is the PROVIDER's timestamp when there is one, so a feed cannot make an old price look fresh by re-stamping it.
  SELECT mp.price, COALESCE(mp.provider_timestamp, mp.updated_at), mp.source_id INTO v_price, v_quoted, v_source
    FROM market_prices mp JOIN instruments i ON i.symbol = mp.symbol AND i.active
   WHERE mp.symbol = p_symbol;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown instrument or quote' USING ERRCODE = 'T0004'; END IF;
  -- Licence gate: only a registered, licensed, unexpired source that allows execution may drive a fill. Demo prices never can.
  SELECT * INTO v_src FROM market_data_sources WHERE id = v_source;
  IF NOT FOUND OR v_src.license_status <> 'licensed' OR NOT v_src.allows_execution
     OR (v_src.valid_until IS NOT NULL AND v_src.valid_until <= now()) THEN
    RAISE EXCEPTION 'market data source is not licensed for execution' USING ERRCODE = 'T0009';
  END IF;
  IF v_quoted > now() + interval '60 seconds' OR now() - v_quoted > interval '15 minutes' THEN
    RAISE EXCEPTION 'quote stale or invalid' USING ERRCODE = 'T0005';
  END IF;

  -- The single rounding of the posting: cash and both ledger entries all use this exact value.
  v_notional := round(p_shares * v_price, 8);
  IF v_notional <= 0 THEN RAISE EXCEPTION 'invalid order' USING ERRCODE = 'T0008'; END IF;

  IF p_side = 'BUY' THEN
    IF v_acct.cash < v_notional THEN RAISE EXCEPTION 'insufficient virtual cash' USING ERRCODE = 'T0006'; END IF;
    UPDATE paper_accounts SET cash = cash - v_notional WHERE id = v_acct.id;
    INSERT INTO paper_positions (account_id, symbol, shares, entry_price)
         VALUES (v_acct.id, p_symbol, p_shares, v_price)
    ON CONFLICT (account_id, symbol) DO UPDATE SET
         entry_price = round((paper_positions.entry_price * paper_positions.shares + EXCLUDED.entry_price * EXCLUDED.shares)
                             / (paper_positions.shares + EXCLUDED.shares), 8),
         shares = paper_positions.shares + EXCLUDED.shares;
    v_cash_type := 'credit'; v_pos_type := 'debit';
  ELSE
    SELECT shares INTO v_held FROM paper_positions WHERE account_id = v_acct.id AND symbol = p_symbol FOR UPDATE;
    IF NOT FOUND OR v_held < p_shares THEN RAISE EXCEPTION 'insufficient virtual position' USING ERRCODE = 'T0007'; END IF;
    IF v_held = p_shares THEN
      DELETE FROM paper_positions WHERE account_id = v_acct.id AND symbol = p_symbol;
    ELSE
      UPDATE paper_positions SET shares = v_held - p_shares WHERE account_id = v_acct.id AND symbol = p_symbol;
    END IF;
    UPDATE paper_accounts SET cash = cash + v_notional WHERE id = v_acct.id;
    v_cash_type := 'debit'; v_pos_type := 'credit';
  END IF;

  INSERT INTO paper_orders (account_id, symbol, side, shares, price, status, idempotency_key, request_hash, price_source_id, price_observed_at)
       VALUES (v_acct.id, p_symbol, p_side, p_shares, v_price, 'filled', p_idempotency_key, p_request_hash, v_source, v_quoted)
    RETURNING * INTO v_order;

  INSERT INTO paper_ledger (account_id, order_id, entry_type, account_code, amount, symbol, shares) VALUES
    (v_acct.id, v_order.id, v_cash_type, 'cash',                   v_notional, p_symbol, p_shares),
    (v_acct.id, v_order.id, v_pos_type,  'position:' || p_symbol,  v_notional, p_symbol, p_shares);

  RETURN jsonb_build_object('replay', false, 'order', to_jsonb(v_order));
END $$;

REVOKE ALL ON FUNCTION aztrade_place_paper_order(text, text, numeric, text, text) FROM PUBLIC;

-- ---------------------------------------------------------------------------------------------
-- 3. Reconciliation. One row per violation; zero rows means the account reconciles.
--    SECURITY INVOKER: it sees exactly what the caller's row-level security allows.
--    The checks are written against the raw tables, independently of the posting procedure.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION aztrade_reconcile_paper_account(p_account uuid)
RETURNS TABLE (check_name text, subject text, expected numeric, actual numeric)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  -- 1. Cash = opening balance - cash credits (buys) + cash debits (sells).
  SELECT 'cash'::text, a.id::text,
         a.opening_cash
           - COALESCE((SELECT sum(amount) FROM paper_ledger WHERE account_id = a.id AND account_code = 'cash' AND entry_type = 'credit'), 0)
           + COALESCE((SELECT sum(amount) FROM paper_ledger WHERE account_id = a.id AND account_code = 'cash' AND entry_type = 'debit'), 0),
         a.cash
    FROM paper_accounts a
   WHERE a.id = p_account
     AND a.cash <> a.opening_cash
           - COALESCE((SELECT sum(amount) FROM paper_ledger WHERE account_id = a.id AND account_code = 'cash' AND entry_type = 'credit'), 0)
           + COALESCE((SELECT sum(amount) FROM paper_ledger WHERE account_id = a.id AND account_code = 'cash' AND entry_type = 'debit'), 0)
  UNION ALL
  -- 2. Positions = filled buys - filled sells, per symbol (from order history, not from the ledger).
  SELECT 'position_vs_fills'::text, s.symbol, s.net, COALESCE(p.shares, 0)
    FROM (SELECT symbol, sum(CASE side WHEN 'BUY' THEN shares ELSE -shares END) AS net
            FROM paper_orders WHERE account_id = p_account AND status = 'filled' GROUP BY symbol) s
    LEFT JOIN paper_positions p ON p.account_id = p_account AND p.symbol = s.symbol
   WHERE COALESCE(p.shares, 0) <> s.net
  UNION ALL
  -- 3. Positions that exist with no fills behind them.
  SELECT 'position_without_fills'::text, p.symbol, 0::numeric, p.shares
    FROM paper_positions p
   WHERE p.account_id = p_account
     AND NOT EXISTS (SELECT 1 FROM paper_orders o WHERE o.account_id = p_account AND o.symbol = p.symbol AND o.status = 'filled')
  UNION ALL
  -- 4. Position ledger entries agree with positions (shares debited minus credited).
  SELECT 'position_vs_ledger'::text, s.symbol, s.net, COALESCE(p.shares, 0)
    FROM (SELECT symbol, sum(CASE entry_type WHEN 'debit' THEN shares ELSE -shares END) AS net
            FROM paper_ledger WHERE account_id = p_account AND account_code LIKE 'position:%' GROUP BY symbol) s
    LEFT JOIN paper_positions p ON p.account_id = p_account AND p.symbol = s.symbol
   WHERE COALESCE(p.shares, 0) <> s.net
  UNION ALL
  -- 5. Every filled order has exactly two ledger entries of the right type and amount round(shares*price, 8).
  SELECT 'order_posting'::text, o.id::text, round(o.shares * o.price, 8),
         COALESCE((SELECT sum(amount) FROM paper_ledger l WHERE l.order_id = o.id), 0) / 2
    FROM paper_orders o
   WHERE o.account_id = p_account AND o.status = 'filled'
     AND ( (SELECT count(*) FROM paper_ledger l WHERE l.order_id = o.id) <> 2
        OR (SELECT count(*) FROM paper_ledger l WHERE l.order_id = o.id AND l.amount = round(o.shares * o.price, 8)) <> 2
        OR (SELECT count(*) FROM paper_ledger l WHERE l.order_id = o.id AND l.account_code = 'cash'
              AND l.entry_type = CASE o.side WHEN 'BUY' THEN 'credit' ELSE 'debit' END) <> 1
        OR (SELECT count(*) FROM paper_ledger l WHERE l.order_id = o.id AND l.account_code = 'position:' || o.symbol
              AND l.entry_type = CASE o.side WHEN 'BUY' THEN 'debit' ELSE 'credit' END) <> 1 )
  UNION ALL
  -- 6. Ledger entries that belong to no filled order.
  SELECT 'orphan_ledger'::text, l.id::text, 0::numeric, l.amount
    FROM paper_ledger l
   WHERE l.account_id = p_account
     AND NOT EXISTS (SELECT 1 FROM paper_orders o WHERE o.id = l.order_id AND o.status = 'filled')
  UNION ALL
  -- 7. Nothing negative.
  SELECT 'negative_cash'::text, a.id::text, 0::numeric, a.cash FROM paper_accounts a WHERE a.id = p_account AND a.cash < 0
  UNION ALL
  SELECT 'nonpositive_position'::text, p.symbol, 0::numeric, p.shares FROM paper_positions p WHERE p.account_id = p_account AND p.shares <= 0;
$$;

COMMIT;
