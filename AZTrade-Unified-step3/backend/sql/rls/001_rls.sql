-- Row-Level Security scaffolding for tenant isolation
-- Apply after schema. Requires app to SET LOCAL app.current_tenant and app.current_user_id
-- in each transaction. Superuser/migration role bypasses RLS.

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolios ENABLE ROW LEVEL SECURITY;
ALTER TABLE holdings ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE assistant_messages ENABLE ROW LEVEL SECURITY;

-- Example policies (tighten per role in production)
CREATE POLICY users_self ON users
  USING (id::text = current_setting('app.current_user_id', true));

CREATE POLICY portfolios_owner ON portfolios
  USING (user_id::text = current_setting('app.current_user_id', true));

CREATE POLICY holdings_owner ON holdings
  USING (portfolio_id IN (
    SELECT id FROM portfolios WHERE user_id::text = current_setting('app.current_user_id', true)
  ));

CREATE POLICY paper_accounts_owner ON paper_accounts
  USING (user_id::text = current_setting('app.current_user_id', true));

CREATE POLICY paper_positions_owner ON paper_positions
  USING (account_id IN (
    SELECT id FROM paper_accounts WHERE user_id::text = current_setting('app.current_user_id', true)
  ));

CREATE POLICY paper_orders_owner ON paper_orders
  USING (account_id IN (
    SELECT id FROM paper_accounts WHERE user_id::text = current_setting('app.current_user_id', true)
  ));

CREATE POLICY paper_ledger_owner ON paper_ledger
  USING (account_id IN (
    SELECT id FROM paper_accounts WHERE user_id::text = current_setting('app.current_user_id', true)
  ));

CREATE POLICY alerts_owner ON alerts
  USING (user_id::text = current_setting('app.current_user_id', true));

CREATE POLICY assistant_owner ON assistant_messages
  USING (user_id::text = current_setting('app.current_user_id', true));

-- Force RLS even for table owner in non-superuser app role
ALTER TABLE users FORCE ROW LEVEL SECURITY;
ALTER TABLE portfolios FORCE ROW LEVEL SECURITY;
ALTER TABLE holdings FORCE ROW LEVEL SECURITY;
ALTER TABLE paper_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE paper_positions FORCE ROW LEVEL SECURITY;
ALTER TABLE paper_orders FORCE ROW LEVEL SECURITY;
ALTER TABLE paper_ledger FORCE ROW LEVEL SECURITY;
ALTER TABLE alerts FORCE ROW LEVEL SECURITY;
ALTER TABLE assistant_messages FORCE ROW LEVEL SECURITY;
