# AZTrade PostgreSQL certification — result of the 2026-11-09 run

**Scope of this result:** the financial core (posting, concurrency, reconciliation, restart recovery, tenant isolation of
the paper ledger) on a real PostgreSQL 16. **Overall verdict is still NO-GO** (see "Not certified").

## Environment
- PostgreSQL **16.14** (EDB Windows binaries zip; the server executables in that zip are unsigned and EDB publishes no checksum,
  so provenance rests on the HTTPS download. Zip SHA-256 `98af1417ba6a8dc30543e560e5407833a3b9e7cc7ed20e73b2006f3aa2f04663`).
- A brand-new cluster per run, `127.0.0.1` port 54329, no other database in it, deleted data directory required to rerun.
- Three roles, none superuser, none BYPASSRLS, none CREATEDB/CREATEROLE: `aztrade_owner` (migrations only),
  `aztrade_provisioner` (INSERT/SELECT on users, portfolios, paper_accounts), `aztrade_app` (runtime).
- Applied as the owner: `schema.sql`, migrations 001-006, `seed.sql`, `roles/app_grants.sql`. All applied cleanly.

## Result: 36 of 36 tests pass, twice, on two independent clusters (archived: `certification-run-2026-11-09.tap`)
| Area | Tests | What is proven |
|---|---|---|
| Original suite (`postgres-certification`) | 4 | PG16, role is not superuser/BYPASSRLS/owner, nine tables RLS enabled and FORCED, unscoped reads empty, identity is transaction-local, cross-tenant insert refused, ledger update/delete/truncate refused |
| Posting and reconciliation (`cert-posting`) | 13 | Balanced two-entry postings; cash equals opening balance minus the exact rounded notional (checked against an independent BigInt calculator); rounding ties; replay and payload-mismatch; input validation; stale/unknown quotes; insufficient cash/position change nothing; weighted-average cost; immutable opening balance; reconciliation detects owner-level corruption; the app role cannot write money tables; forged tenant claim refused |
| Concurrency (`cert-concurrency`) | 7 | 40 parallel BUYs with cash for 25 give exactly 25 fills (never overspent); 30 SELLs with 10 held give exactly 10; 20 same-key requests give 1 fill and 19 replays of the same order; conflicting payloads on one key: exactly one wins; interleaved BUY/SELL on two symbols match an independent recomputation; two tenants never interfere; 400-order storm over 6 accounts on 24 connections with no deadlocks and every account reconciling |
| HTTP route (`cert-http`) | 6 | Real router + real request-scoped DB middleware as the restricted role: 201/200/409 semantics, validation codes, parallel same-key and overspend races, forged tenant, per-account view |
| Restart recovery (`cert-restart`) | 6 | Client dies mid-transaction; lost acknowledgement after COMMIT replays; server **crash recovery** (`pg_ctl restart -m immediate`) discards uncommitted work and keeps committed work; crash during an 80-order parallel storm: every acknowledged order survives and every key ends up posted exactly once; graceful restart and pool recovery; the **API process survives** a database crash during in-flight HTTP requests |

## Negative controls (the tests have teeth)
Deliberately breaking the posting procedure made the suite fail each time: no account row lock (5 of 7 concurrency tests fail),
unrounded cash movement (2 of 13 posting tests fail), replay disabled (3 of 20 fail). The restored procedure passes 20 of 20.
Run with `.\scripts\run-certification.ps1 ... -Negative`.

## Defects found by running it, and fixed
1. **Database restart crashed the API process.** A checked-out `pg` client emits an `error` event when the server dies; with no
   listener Node raises an uncaught exception. Fixed in `lib/request-db.js`, `lib/tenant-db.js`, `lib/db.js` (listener while checked
   out; dead connections are discarded), and the order route answers 503 + `Retry-After` for outages. Guarded by a test.
2. Cash and ledger could in principle round differently at exact ties; now one rounding is shared (procedure computes it once).
3. The supplied ledger test ran two expected failures in one transaction (second hit "transaction aborted"); now uses savepoints.

## Not certified (still required before any GO)
- Migration repeatability, rollback and backfill of **legacy data** (no legacy data was available; the opening balance of
  legacy accounts is derived, not independent evidence). Restore from backup.
- Complete RLS matrix for every table and command (SELECT/INSERT/UPDATE/DELETE), ownership transfers, inherited grants.
- Replication/failover, backups, monitoring; Windows-only run (production target unverified).
- The real A-Zee identity, licensed market data, subscriptions and AI integrations (step 3); browser/mobile/security testing.
- `AZTRADE_PAPER_EXECUTION_CERTIFIED` stays **false**. Live trading stays **off**.
