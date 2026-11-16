# AZTrade AI — Release Evidence Matrix

> **This is the single source of truth for release status.** Last reviewed 2026-11-16.
> `IMPLEMENTATION_STATUS.md`, `CERTIFICATION_NEXT_STEPS.md`, `POSTGRES_CERTIFICATION.md` and the design narrative (`AI-TradeAZee.txt`) are history and design
> reference. If any of them disagrees with this matrix, this matrix wins. The authoritative code is `AZ_AI/AZTrade-Unified` (see `PROVENANCE.md` in the
> standalone `AZTrade` snapshot, which lags behind and must not be used to judge release status).

**Current decision: NO-GO** (not production-ready, not approved for public use)  
**Target: Production GO (non-live) after G01–G14 pass with evidence**  
**Live trading: OFF (G15 is a separate regulatory/broker track).** `AZTRADE_PAPER_EXECUTION_CERTIFIED` must stay `false`; the paper-order route refuses to run unless it is exactly `true`.

Status words: **PASS** needs evidence from the production target. **PARTIAL** means built and tested, but only on local or disposable infrastructure, or only for a subset. **BLOCKED** means a dependency outside the code is missing. **DISABLED** means deliberately off.

| Gate | Requirement | Status | Evidence (what exists) | Blocker (what is still missing) |
|------|-------------|--------|------------------------|----------------------------------|
| G01 | Identity | PARTIAL | A-Zee RS256 token plus live-session introspection over mTLS on every call; provisioning binds user and tenant (migration 008); fails closed. Tests: `identity`, `cert-identity`, `mtls-required`, `identity-mtls-keys`. | Verified on a LOCAL native staging stack only. No production issuer, audience, key rotation or revocation evidence. |
| G02 | Tenant isolation | PARTIAL | RLS enabled and FORCED on the private tables; restricted roles (no superuser, no BYPASSRLS); forged-tenant and cross-tenant refusals tested on PostgreSQL 16.14. | Full SELECT/INSERT/UPDATE/DELETE matrix for every table, ownership transfers and inherited grants; production database not audited. |
| G03 | Financial ledger | PARTIAL | One PostgreSQL-owned posting procedure in NUMERIC with a single rounding; balanced two-entry postings; immutable opening balance; reconciliation function. Tests: `cert-posting` (13). | Legacy-data backfill and rollback; cash and positions reconciled against all historical orders; independent reviewer. |
| G04 | Paper orders | PARTIAL | Mandatory idempotency, replay and payload-mismatch handling, quote-freshness checks. 40 parallel buys never overspend; crash recovery (`pg_ctl restart -m immediate`) keeps every acknowledged order. Tests: `cert-concurrency`, `cert-http`, `cert-restart`; negative controls proved the tests detect a broken procedure. | Local PostgreSQL 16 only. Independent certification not done, so execution stays disabled. |
| G05 | Market data | BLOCKED | Provider contract with a licence gate: a source must be licensed, carry a licence reference, allow execution and be unexpired; prices from `demo-seed` can never drive a fill; freshness uses the provider's own timestamp. Fails closed with no provider. Tests: `marketdata`, `cert-marketdata`. A-Zee also shows delayed, informational quotes from free public sources, which are NOT licensed for trading. | No licensed vendor chosen, registered or contracted. |
| G06 | Portfolio | PARTIAL | Deterministic P/L from database prices. | Display math still uses JavaScript Number; no corporate actions, multi-currency or independent fixtures. |
| G07 | Strategy and backtests | BLOCKED | Historical engine implemented (`lib/backtest.js`, tests in `backtest.test.js`): daily bars, long only, next-bar open, fees and slippage, per-plan bar limits, daily run quota. With no licensed bars the route answers 503 and returns no numbers: no illustrative results are returned by this tree. | Needs a licensed historical-data provider. Corporate actions and exchange calendars are not modelled. The standalone `AZTrade` snapshot still carried hard-coded demo output; it now fails closed too. |
| G08 | AI assistant | PARTIAL | A-Zee model bridge over mTLS with grounding and bounds (disallows unsupported amounts and claims); daily research quota. Tests: `aztrade-ai`, `assistant-bridge`, `intelligence`. Answers are a guardrail, not a guarantee. | Grounding is not source verification. Privacy controls and factual-accuracy evaluation are not done. |
| G09 | Risk and alerts | PARTIAL | Exposure calculation; price-alert monitors with push notifications in A-Zee. | No durable delivery guarantees or policy engine. |
| G10 | Subscriptions and quotas | PARTIAL | Live plan resolution (including pro25/pro60/pro500 mapped to premium), tier gates, atomic daily reserve/refund quotas. Tests: `aztrade-entitlements`, `aztrade-quota`. | Some plan limits are placeholders awaiting a product decision; billing is not connected to a production payment provider. |
| G11 | Frontend | PARTIAL | Server-backed client (no localStorage financial state, no HTML interpolation of data, strict CSP). Test: `frontend`. | Browser end-to-end through a deployed gateway; mobile and accessibility testing. |
| G12 | Mobile companion | PARTIAL | A-Zee mobile app has AZTrade screens that show only delayed quotes and clearly mark backtests and trading as unavailable. | Share flows and full companion not tested on Android and iOS devices. |
| G13 | Deployment and operations | PARTIAL | Hardened Docker Compose (secret from environment, no public database port, seeding opt-in); gateway and mTLS staging tests (`aztrade-gateway`, `aztrade-mtls`, `aztrade-deploy-*`); backup test (`cert-backup`). | Production backup and restore drill, replication or failover, monitoring and alerting, secret manager, incident response. |
| G14 | Certification | PARTIAL | 50 tests pass on disposable PostgreSQL 16.14 clusters (financial core), plus 51 backend tests without a database and the A-Zee test suite. See `docs/CERTIFICATION_RESULT_2026-11-09.md`. | Security, browser and mobile suites; production-like environment; independent review. |
| G15 | Live trading | DISABLED | Explicitly off in code and configuration. | Separate regulatory and broker track. |

## Release rule

Non-live production GO requires G01–G14 = PASS with evidence from the target environment.  
Any FAIL or BLOCKED mandatory gate = **NO-GO**. Passing development tests alone is never a GO.  
Live trading remains **OFF**.

## Operating rules while the decision is NO-GO

- Treat the product as a controlled internal beta or research platform.
- Keep paper execution off (`AZTRADE_PAPER_EXECUTION_CERTIFIED` unset or `false`) and live trading off.
- Keep every market-data and execution path fail-closed. Delayed public quotes are informational only.
- Never commit keys, tokens or environment values. `npm test` includes a scan of tracked files for committed secrets.
- Update this matrix in the same change that alters the evidence, and keep the status words above honest.
