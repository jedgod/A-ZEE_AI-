# AZTrade unified implementation — 2026-11-09

## Included
- Original v3 app plus earlier security-hardening work, in one folder.
- Transaction-local verified identity on protected routes.
- SQL migration 004: tenant/user RLS on all private tables, removal of earlier permissive policies.
- SQL migration 005: paper ledger deferred balance check and restrictive order-history FK.
- Paper order endpoint: account lock, SQL NUMERIC arithmetic, mandatory idempotency, quote age checks, atomic cash/position/order/ledger transaction.
- Private portfolio, assistant and risk routes moved to request-scoped DB client; writes explicitly COMMIT.
- Reconciliation SQL and static contract tests.

## Not production-certified
- No PostgreSQL server/client available in this execution environment; migrations and real integration/concurrency/RLS tests NOT executed.
- A-Zee signed JWT must contain aztrade_user_id UUID and tenant_id matching provisioned users; actual issuer/introspection integration NOT verified.
- Database role grants, BYPASSRLS, ownership and migration privileges NOT audited against real PostgreSQL.
- Ledger balances are checked per posted order, but cash/positions reconciliation against all historical orders and account opening balance remains to be certified.
- Legacy data must be cleaned/backfilled before applying migrations. Some constraints may fail on historical rows.
- Existing frontend has localStorage authority and unsafe HTML rendering; DO NOT expose to public users.
- Market prices lack licensed provider provenance; trading must remain disabled.
- No real AI, backtest engine, quota enforcement, mobile companion, broker integration, backups, staging or operational certification.
- `AZTRADE_PAPER_EXECUTION_CERTIFIED` MUST remain false until independent PG certification.
- Live trading remains OFF.

## Required certification
1. Run 001,002,003,004,005 in order on a disposable PostgreSQL 16 instance, with a non-owner app role. Validate backfill, migration repeatability, restore and rollback.
2. Test two distinct tenants, forged tenant claims, missing tenant context, RLS SELECT/INSERT/UPDATE/DELETE, ownership transfers, inherited grants and BYPASSRLS.
3. Execute parallel BUY/SELL and duplicate idempotency requests (same/different payload), injected crashes, timeouts, PG restarts; assert no overspend, duplicate fills or unbalanced ledger.
4. Reconcile opening cash, cash postings, positions, fills and order history using independent fixtures.
5. Integrate real A-Zee identity and subscriptions, licensed market data, remove frontend local financial state and XSS sinks, implement real AI/backtests/alerts.
6. Run security/browser/mobile, failover, backups/restore, monitoring and regulatory/data-license gates.

Verdict: **NO-GO**. This is an implementation candidate, not a production certification.
