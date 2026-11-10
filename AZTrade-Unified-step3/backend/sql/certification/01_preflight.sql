-- Run as an authorized DBA on a disposable PostgreSQL instance.
-- A result row with fail_reason means NO-GO.
SELECT current_database() AS database_name, current_user AS connected_role, version() AS postgres_version;
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;
SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('users','portfolios','holdings','paper_accounts','paper_positions','paper_orders','paper_ledger','alerts','assistant_messages')
ORDER BY c.relname;
SELECT table_name, privilege_type, grantee FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name IN ('paper_accounts','paper_ledger','paper_orders')
ORDER BY table_name,grantee,privilege_type;
