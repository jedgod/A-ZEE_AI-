# AZTrade AI mobile workspace — Expo Router integration

**Target:** `jedgod/A-ZEE_AI-`, branch `fix/audit-gaps-2026-11-10`, Expo 58 app under `mobile/`.

This is a production-oriented *mobile UI integration*, not a certified trading service. It uses the existing A-Zee mobile session and the V2 AZTrade companion gateway. No separate account, static quotes, brokerage passwords, or order submission are introduced.

## Install

1. Work on an isolated branch based on `fix/audit-gaps-2026-11-10`; preserve all unrelated changes.
2. Copy `mobile/src/lib/aztrade.ts` and `mobile/src/app/(app)/aztrade.tsx` into the respective paths of A-Zee.
3. Apply both changes described in `patches/REGISTER_SCREEN.md` (stack and Account link).
4. Ensure V2 companion endpoints exist. `AZTRADE_AI_COMPANION_ENABLED=true` is permitted for isolated development only; do not enable uncertified execution.
5. Configure `EXPO_PUBLIC_API_URL` to A-Zee's reachable origin. On a physical device, this must **not** be `localhost`; use a private secure host or properly configured development tunnel.
6. Run `cd mobile && npm ci && npm run typecheck && npx expo-doctor` and build an Android dev client with the actual native project.
7. Test login, logout, revoked session, downgrade, AI quota exhausted, offline backend, auth token retry, accessibility, screen readers, and network interruptions on real Android and iOS devices.

## UI behavior

- Overview: account-backed practice cash/positions when present, server-reported market and broker status.
- AI Research: prompt, secure UUID, replay-safe retry, response, history. AI quota and moderation remain server-enforced.
- Portfolio: only real backend-provided practice-account records. No fabricated portfolio returns.
- Markets: education-only categories until licensed data exists.
- Risk: backend facts only; unavailable when not connected.
- Connections: informational; no brokerage OAuth flow or order buttons.

## Security

- A-Zee mobile auth token is loaded by existing secure mobile session storage; AZTrade JWT only lives in memory and is discarded on unmount/account change.
- The server must verify both the A-Zee session and AZTrade JWT against the same user, with per-request introspection, subscription and tenant checks.
- Never add execution routes to this client until separate certification and legal approvals. Paper/live execution must remain OFF.
- Never render demo seed prices as licensed or quote available until provider rights and freshness have been checked server-side.

## Known production gates

This package is UI-level code. It is NOT a production launch by itself. Full build, backend end-to-end tests, DB/AI quota concurrency, broker approval, licensed feeds, and app-store/security review are unverified. Tested source syntax is not evidence of runtime integration.
