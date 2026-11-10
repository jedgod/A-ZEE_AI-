# AZTrade AI — Release Evidence Matrix

**Current decision: NO-GO**  
**Target: Production GO (non-live) after G01–G14 pass with evidence**  
**Live trading: OFF (G15 separate track)**

| Gate | Requirement | Status | Evidence | Blocker |
|------|-------------|--------|----------|---------|
| G01 | Authentication | BLOCKED | Auth fails closed in production; JWT verifier is a placeholder that rejects all tokens | Real A-Zee JWKS/issuer/audience/revocation not wired |
| G02 | Tenant isolation | PARTIAL | RLS policies in `sql/rls/001_rls.sql`; tenant_id column added | Policies not applied in CI; no transaction-scoped `SET LOCAL` in app role |
| G03 | Financial ledger | PARTIAL | `paper_ledger` double-entry writes on fill | No independent reconciliation job; still uses JS Number for intermediate math |
| G04 | Paper orders | PARTIAL | Mandatory idempotency, request hash, transactional locks, future-timestamp reject | No full order state machine; concurrency suite not run |
| G05 | Market data | BLOCKED | Freshness + future-timestamp checks exist | No licensed provider, no provenance, no outage handling |
| G06 | Portfolio | PARTIAL | Deterministic P/L from DB prices | No corporate actions, multi-currency, or independent fixtures |
| G07 | Strategy Lab | BLOCKED | Illustrative hardcoded results only | No historical engine |
| G08 | AI Assistant | BLOCKED | Rule-based grounded replies from DB | No A-Zee model routing or privacy controls |
| G09 | Risk & Alerts | PARTIAL | Exposure calc + manual alerts | No durable delivery workers or policy engine |
| G10 | Subscriptions | PARTIAL | `requireTier` on strategy backtest | No durable quotas on other routes |
| G11 | Frontend | BLOCKED | SPA exists | Still localStorage financial authority; innerHTML usage |
| G12 | AZLinqTrade | BLOCKED | Companion UI stub only | No tested Android/iOS share flows |
| G13 | Deployment | PARTIAL | Docker Compose hardened (env password, no public port, seed opt-in); helmet + audit log | No backup/restore, monitoring, or secret manager |
| G14 | Certification | BLOCKED | Smoke tests 3/3 pass | No integration, concurrency, security, or browser suite |
| G15 | Live trading | DISABLED | Explicitly off | Separate regulatory/broker track |

## Stage progress

- **Stage A (Security foundation)**: Partial — fail-closed auth, RLS scaffolding, helmet, audit logging
- **Stage B (Financial engine)**: Partial — ledger, mandatory idempotency, transactional orders
- **Stage C (Financial intelligence)**: Not started (requires licensed data + AI orchestration)
- **Stage D (Product integration)**: Minimal (tier gate on one route)
- **Stage E (Certification)**: Smoke tests only

## Release rule

Non-live production GO requires G01–G14 = PASS with evidence.  
Any FAIL or BLOCKED mandatory gate = **NO-GO**.  
Live trading remains **OFF**.
