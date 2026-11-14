# AZTrade AI — Desktop Workstation V3

Target: `jedgod/A-ZEE_AI-`, branch `fix/audit-gaps-2026-11-10`, extending the prior V2 AZTrade AI companion gateway. This is a UI implementation package, **not a certification of production trading**.

## Files
- `app/aztrade/page.tsx`: responsive AI-first desktop interface with overview, account-grounded portfolio, market education, strategies, risk, broker states and assistant history.
- `app/aztrade/aztrade.module.css`: fully scoped responsive styling, accessibility and mobile drawer.

## Installation
1. Create an isolated feature branch on top of the correct A-Zee development branch; preserve unrelated changes.
2. Ensure the V2 gateway is already integrated (`/api/aztrade/token`, `/api/aztrade/capabilities`, `/api/aztrade/companion`). Do not replace `lib/aztrade/identity.ts`, `lib/aztrade/ai.ts`, user authentication, billing, or the backend.
3. Copy `app/aztrade/page.tsx` and `app/aztrade/aztrade.module.css` into the A-Zee repository.
4. Optional: add `{link('/aztrade','AZTrade AI',<ChartCandlestick size={20}/>)}` to `components/user/icon-rail.tsx` after importing the icon from `lucide-react`.
5. Preserve `AZTRADE_PAPER_EXECUTION_CERTIFIED=false`, `AZTRADE_REAL_MONEY_TRADING_ENABLED=false`, and `AZTRADE_LIVE_ORDER_ROUTING_ENABLED=false` in *every* execution service.
6. Run `npx tsc --noEmit`, `npm test -- --run` where supported, and browser E2E with a verified user. Start the backend only against a non-production database.

## Backend interface actually used
- `GET /api/aztrade/capabilities` (current A-Zee session)
- `POST /api/aztrade/token` (current A-Zee session), expects `access_token`
- `GET /api/aztrade/companion?resource=paper`
- `GET /api/aztrade/companion?resource=risk`
- `GET /api/aztrade/companion?resource=assistant/history`
- `POST /api/aztrade/companion?resource=assistant/chat` with `{ requestId, message }`

Uses in-memory short-lived AZTrade token only; no client-side account credentials in storage. Research retries reuse the same request ID on an unauthorized response. Token and account data are never included in server-rendered HTML. The backend retains authoritative session, subscription, quota, and RLS enforcement.

## Operational cautions
- The current `GET /api/risk` contract may vary: this UI renders raw source response only when present, never guesses numeric metrics.
- Quotes, market charts, real backtests, broker OAuth and live trading are explicitly unavailable until licensed connectors and independent certification.
- Current A-Zee sign-in route is assumed `/sign-in`; adapt if the host differs.
- The `POST /api/aztrade/token` browser request must continue to satisfy existing A-Zee CSRF and origin protections. Do not weaken them to make the screen work.
- The API gateway and session routes from the earlier package must be merged and tested separately; this package contains no new privileged backend endpoint.
- Verification required: ESLint, actual A-Zee TypeScript check, visual QA, network failure, session revocation, plan downgrade, accessibility, auth E2E, Android responsive view, PostgreSQL RLS, quota concurrency.

## Release decision
UI implementation only. Not verified against production; NO-GO for real-money and paper execution.
