# AZTrade v3: Financial and database authorization milestone

## What this package does
- Combines the previous security patch and financial guard starter in one ZIP.
- Adds PostgreSQL preflight, ledger reconciliation and RLS policy inventory SQL.
- **Fails closed** for paper order execution unless `AZTRADE_PAPER_EXECUTION_CERTIFIED=true`. Leave unset/false; do not set true without certification.
- Preserves the original source for remediation.

## What it does NOT do
It does not implement complete production financial accounting, tenant-isolated route transactions, or real A-Zee identity integration. Do not expose the application publicly. The existing paper execution algorithm still uses JavaScript Number arithmetic and lacks a guaranteed balanced posting procedure. The previous SQL RLS file is scaffolding and is NOT certified.

## Mandatory next implementation tasks
1. Map verified A-Zee subject to internal user UUID and tenant UUID. Replace every private pool.query with transaction-scoped, least-privilege queries.
2. Backfill tenant_id; apply complete RLS policies with both USING and WITH CHECK. Verify FORCE RLS, role memberships, BYPASSRLS=false, PUBLIC grants and cross-tenant read/write refusal.
3. Implement a PostgreSQL-owned order posting procedure using NUMERIC only, account row locks, balanced ledger entries, canonical idempotency state and response replay. Make the ledger append-only and remove cascade deletion paths.
4. Reconcile cash and positions with ledger snapshots; prove replay, concurrency, rollback, crash recovery and multi-tenant isolation against real PostgreSQL.
5. Only after the above passes, enable paper execution in isolated staging and test all APIs/browser flows.

## Running checks (disposable database ONLY)
```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/sql/certification/01_preflight.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/sql/certification/02_ledger_reconciliation.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/sql/certification/03_rls_policy_inventory.sql
cd backend && npm test
```
These are diagnostic checks, not a full certification suite. Any ledger query returning rows is a failure.

## Release verdict
NO-GO until authenticated tenant isolation, financial correctness, real integrations and full certification pass. Live trading remains OFF.
