-- Apply only after migration 001-003, user tenant backfill and DB role review.
-- App role MUST NOT own tables or have BYPASSRLS. Run as migration owner.
BEGIN;
DROP POLICY IF EXISTS assistant_owner ON assistant_messages;
DROP POLICY IF EXISTS alerts_owner ON alerts;
DROP POLICY IF EXISTS paper_ledger_owner ON paper_ledger;
DROP POLICY IF EXISTS paper_orders_owner ON paper_orders;
DROP POLICY IF EXISTS paper_positions_owner ON paper_positions;
DROP POLICY IF EXISTS paper_accounts_owner ON paper_accounts;
DROP POLICY IF EXISTS holdings_owner ON holdings;
DROP POLICY IF EXISTS portfolios_owner ON portfolios;
DROP POLICY IF EXISTS users_self ON users;
CREATE OR REPLACE FUNCTION aztrade_user_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid
$$;
CREATE OR REPLACE FUNCTION aztrade_tenant_id() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_tenant', true), '')
$$;
CREATE OR REPLACE FUNCTION aztrade_is_owner(uid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM users u WHERE u.id=uid AND u.id=aztrade_user_id()
    AND u.tenant_id=aztrade_tenant_id() AND u.tenant_id IS NOT NULL)
$$;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trade_users_self ON users;
CREATE POLICY trade_users_self ON users USING
 (id=aztrade_user_id() AND tenant_id=aztrade_tenant_id() AND tenant_id IS NOT NULL)
 WITH CHECK (id=aztrade_user_id() AND tenant_id=aztrade_tenant_id() AND tenant_id IS NOT NULL);
ALTER TABLE portfolios ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolios FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trade_portfolios_owner ON portfolios;
CREATE POLICY trade_portfolios_owner ON portfolios USING (aztrade_is_owner(user_id)) WITH CHECK (aztrade_is_owner(user_id));
ALTER TABLE holdings ENABLE ROW LEVEL SECURITY;
ALTER TABLE holdings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trade_holdings_owner ON holdings;
CREATE POLICY trade_holdings_owner ON holdings USING
 (EXISTS (SELECT 1 FROM portfolios p WHERE p.id=portfolio_id AND aztrade_is_owner(p.user_id)))
 WITH CHECK (EXISTS (SELECT 1 FROM portfolios p WHERE p.id=portfolio_id AND aztrade_is_owner(p.user_id)));
ALTER TABLE paper_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_accounts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trade_paper_accounts_owner ON paper_accounts;
CREATE POLICY trade_paper_accounts_owner ON paper_accounts USING (aztrade_is_owner(user_id)) WITH CHECK (aztrade_is_owner(user_id));
ALTER TABLE paper_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_positions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trade_paper_positions_owner ON paper_positions;
CREATE POLICY trade_paper_positions_owner ON paper_positions USING
 (EXISTS (SELECT 1 FROM paper_accounts a WHERE a.id=account_id AND aztrade_is_owner(a.user_id)))
 WITH CHECK (EXISTS (SELECT 1 FROM paper_accounts a WHERE a.id=account_id AND aztrade_is_owner(a.user_id)));
ALTER TABLE paper_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_orders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trade_paper_orders_owner ON paper_orders;
CREATE POLICY trade_paper_orders_owner ON paper_orders USING
 (EXISTS (SELECT 1 FROM paper_accounts a WHERE a.id=account_id AND aztrade_is_owner(a.user_id)))
 WITH CHECK (EXISTS (SELECT 1 FROM paper_accounts a WHERE a.id=account_id AND aztrade_is_owner(a.user_id)));
ALTER TABLE paper_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_ledger FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trade_paper_ledger_owner ON paper_ledger;
CREATE POLICY trade_paper_ledger_owner ON paper_ledger USING
 (EXISTS (SELECT 1 FROM paper_accounts a WHERE a.id=account_id AND aztrade_is_owner(a.user_id)))
 WITH CHECK (EXISTS (SELECT 1 FROM paper_accounts a WHERE a.id=account_id AND aztrade_is_owner(a.user_id)));
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trade_alerts_owner ON alerts;
CREATE POLICY trade_alerts_owner ON alerts USING (aztrade_is_owner(user_id)) WITH CHECK (aztrade_is_owner(user_id));
ALTER TABLE assistant_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trade_assistant_owner ON assistant_messages;
CREATE POLICY trade_assistant_owner ON assistant_messages USING (aztrade_is_owner(user_id)) WITH CHECK (aztrade_is_owner(user_id));
COMMIT;
