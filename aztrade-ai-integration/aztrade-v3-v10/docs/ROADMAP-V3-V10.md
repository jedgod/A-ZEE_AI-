# AZTrade AI V3–V10: implementation and closure evidence

**Baseline:** A-Zee branch `fix/audit-gaps-2026-11-10`, using existing `lib/aztrade/identity.ts`, `lib/aztrade/ai.ts`, PostgreSQL and `AZTrade-Unified-step3/backend`. Keep app auth/session/subscriptions authoritative. Do not add an alternate login or payment flow. The package is an incremental patch, NOT a complete replacement repository.

| Milestone | Delivered code | Must complete to close |
| --- | --- | --- |
| V3 Licensed market data | `backend/lib/market-data.js`, license registry SQL | Sign redistribution/display/historical terms; implement vendor adapter; verify symbols, history, corporate actions, timestamps and outages |
| V4 Read-only brokers | `broker-readonly.js`, RLS-backed connections | Vendor approval; OAuth PKCE state/nonce and redirects; secret-manager token storage/rotation; disconnect/revocation; broker sandbox tests |
| V5 Portfolio intelligence | `portfolio.js`, limited portfolio risk route | Verified broker read data, cross-currency conversion, issuer/sector classifications, stale-data rejection, decimals and aggregation |
| V6 Atomic daily quotas | PostgreSQL `reserve_daily_quota` and `finalize_daily_quota`, A-Zee `/research` | Link entitlements to billing DB instead of default plan map; run concurrent PostgreSQL tests and TTL/recovery worker |
| V7 Historical backtests | `backtest.js` | Calibrated corporate actions, exchange calendars, precision math, survivorship bias, corporate events, dividends, realistic historical costs, reproducible dataset versions, regression baselines |
| V8 A-Zee AI research | `research-policy.js`, A-Zee `/api/aztrade/research` (educational only) | Source retrieval, moderation/PII integration, factual grounding/citation validator, separate metering and adverse-content review |
| V9 Mobile/web integration | Reuse V2 screen/sidebar components | Actual navigation, onboarding, account-consent and credential UX, accessibility and Android/iOS device tests |
| V10 Closure/release | Tests, migration and gates | Production credentials and observability, security review, load and failover, RLS tests, vendor licensing and regulatory/legal review. Separate certification for paper orders; real-money trading stays OFF |

## Security boundaries
1. **Trading**: existing SQL stored procedure and route must remain gated; this package provides no order execution capability. Production defaults for `AZTRADE_PAPER_EXECUTION_CERTIFIED`, `AZTRADE_REAL_MONEY_TRADING_ENABLED` and `AZTRADE_LIVE_ORDER_ROUTING_ENABLED` remain `false`.
2. **Identity**: A-Zee issues 5-minute AZTrade JWT; AZTrade backend validates signature and introspects live session on **every request** using private mTLS, validates account and tier, and uses existing tenant-scoped `requestDb`.
3. **Market data**: fixtures/demo prices do not count as licensed and must never drive fills, verified portfolio valuations or actual backtests.
4. **Broker**: read-only OAuth adapter interface only. User login/password and trading permissions are forbidden. Broker onboarding is not implemented until provider documents and permission are obtained.
5. **Daily research**: atomically reserve once per `(user,scope,requestId)` and release on failure. Retried reservation IDs return replay, not a new inference. Recovery and completed response persistence must be added before production rollout. The quota SQL requires a scoped application role and transaction-safe tests.
6. **AI**: A-Zee owns inference. New research route currently supports *general education* only; no unsourced live prices or financial guarantees. Existing `lib/aztrade/ai.ts` handles paper-account grounding and separate monthly usage. Reconcile monthly and daily accounting as one policy before enabling additional research endpoints.
7. **Operation**: no public exposure of port 4010; no migration against production before staging dry run. Do not place OAuth tokens in PostgreSQL or browser storage.

## Integration points
- Existing A-Zee route: `app/api/aztrade/token`, `introspect`, `jwks`, `ai`.
- Existing AZTrade Express: `AZTrade-Unified-step3/backend/server.js`; mount `intelligenceRouter` only after `authMiddleware, requestDb` on `/api/intelligence`.
- Existing A-Zee client entry: `/aztrade` and icon rail from V2.
- Existing subscriptions: `lib/plans.ts`. Replace the temporary `research-access.ts` plan limits with a dedicated `aztrade_research_daily` billing entitlement before rollout.
- SQL migration owner: choose next available number in the AZTrade backend migration sequence; filename `009_*` is provisional and must be rebased against database history.

## Gate verdict
All V3–V10 milestones are **implementation scaffolds / partially implemented**, not closed or production certified. Run full app + DB + device tests; a unit-test pass only verifies the isolated deterministic modules.

### OAuth provider adapter specification
`oauth-pkce.js` implements PKCE S256, 5-minute state, exact preapproved redirect URI and a one-time state-store contract. The host must implement atomic `stateStore.create` and `stateStore.consume`, an encrypted vault, token refresh, broker `revoke`, and actual provider-specific endpoints. Never start a flow without verified broker approval and consent UI.

### Licensed HTTP market data specification
`licensed-http-provider.js` enforces a static HTTPS host allowlist and explicit response mapper. The backend must supply the actual licensed endpoint path/query mapping per vendor. It intentionally does not select a vendor or supply commercial credentials. Combine with `market-data.js` licensing registry and timestamp/quality validation before any research valuation.
