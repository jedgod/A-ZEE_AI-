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


---

## Update 2026-11-09 (evening): posting procedure, opening balance, reconciliation — IMPLEMENTED AND CERTIFIED ON POSTGRESQL 16.14 (financial core only)

**Executed:** 36 of 36 certification tests pass on two independent PostgreSQL 16.14 clusters, and three negative controls (deliberately broken procedure) are each caught. Evidence: `docs/CERTIFICATION_RESULT_2026-11-09.md` and `docs/certification-run-2026-11-09.tap`. Verdict is still **NO-GO** overall (identity, market data, subscriptions, AI, frontend, legacy-data migration, restore, failover and security/browser/mobile testing are not done).

### Added
- `backend/sql/migrations/006_posting_procedure_and_reconciliation.sql`
  - `aztrade_place_paper_order()`: one PostgreSQL-owned procedure that locks the account row, replays idempotent retries
    (same key + same payload), refuses a reused key with a different payload, checks quote freshness, computes the notional
    in NUMERIC with a single `round(.., 8)` used for cash AND both ledger entries, updates the position, inserts the order
    and a balanced two-entry ledger posting. `SECURITY DEFINER` with a pinned `search_path`; FORCE RLS still applies.
  - `paper_accounts.opening_cash`: recorded at account creation and immutable (trigger). Legacy rows are backfilled by
    derivation from current cash and the ledger (not independent evidence).
  - `aztrade_reconcile_paper_account()`: returns one row per violation (cash vs opening balance + ledger; positions vs fills;
    positions vs ledger; per-order posting amount/type; orphan ledger rows; negatives). No rows = reconciles.
- `backend/sql/roles/app_grants.sql`: least privilege. The runtime role can SELECT and EXECUTE the procedure only; it cannot
  write cash, positions, orders or the ledger directly. A separate provisioner role creates users/accounts.
- `backend/routes/paper.js`: now a thin wrapper that calls the procedure and maps its SQLSTATE class `T0` errors to HTTP.
- `backend/scripts/cert-provision.mjs`, `scripts/run-certification.ps1`: build a fresh, local, dedicated-port PostgreSQL 16 cluster
  with three non-superuser, NOBYPASSRLS roles (migration owner, provisioner, application) and run every suite.
- Tests (skip, never pass, when no disposable database is configured): `cert-posting`, `cert-concurrency`, `cert-http`,
  `cert-restart` (includes `pg_ctl restart -m immediate` crash recovery).

### Verified (static, before the database run)
- Static contract tests and smoke tests: 12/12. Syntax checks of all new JavaScript.
- Defects found by the real run and fixed: a database restart crashed the API process (unhandled error event on checked-out connections); one ledger test ran two expected failures in one transaction.
- Still not certified: legacy-data backfill/rollback, restore, failover, full RLS matrix, ownership transfers.

### Known limitations
- Stub auth cannot work once migration 004 forces RLS (the demo user has no tenant). Identity integration is the next phase.
- Portfolio and risk routes still use JavaScript Number for display math (not ledger-bearing).


---

## Update: market-data provenance and licence gate (slice 1 of step 3) — 47 of 47 pass

Migrations renumbered: **006_market_data_provenance.sql** (new), **007_posting_procedure_and_reconciliation.sql** (previously 006).
- Every price names a registered source (`market_data_sources`). Only the database owner can register or relicense a source.
  Seeded or unregistered prices default to `demo-seed`, which can never drive a fill (T0009). A source must be `licensed`, carry a
  licence reference, allow execution and be unexpired. Every fill records `price_source_id` and `price_observed_at`.
- Freshness uses the provider's own timestamp, which can never be in the future; a stored price can never move backwards in provider time.
- `lib/marketdata`: provider contract (no vendor configured; `NotConfiguredProvider` fails closed) and validated ingestion
  (exact-decimal checks, stale/future/outlier/not-newer rejection, no write on outage) through a market-data role that cannot register
  sources, change licences or touch accounts, orders or the ledger.
- Evidence: `docs/certification-run-2026-11-09-b.tap` (47 ok lines). Unit tests: 10 (no database). Contract tests: 14.
- Test fixtures register a source named `cert-fixture` with licence reference `CERT-TEST-ONLY-NOT-A-REAL-LICENCE`. It is not a real licence.

**Still to do for step 3:** identity (A-Zee token issuer, JWKS, introspection, provisioning), subscriptions, AI. A licensed vendor is still to be chosen and registered by you.
