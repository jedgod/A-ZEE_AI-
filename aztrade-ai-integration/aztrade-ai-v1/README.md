# AZTrade AI — A-Zee integrated launch foundation

Target repository: `jedgod/A-ZEE_AI-`, branch `fix/audit-gaps-2026-11-10` (inspected November 12, 2026). **Do not apply to `main` or overwrite existing AZTrade identity/billing/AI bridge.**

This patch adds a first-party `/aztrade` mobile-responsive screen and an A-Zee-origin restricted backend gateway while reusing `app/api/aztrade/token`, `lib/aztrade/identity.ts`, and the AZTrade backend's `/api/assistant/chat`. It is an AI-first research landing area, not live trading or certified market research.

## Install into an isolated worktree

1. `git fetch origin`
2. `git worktree add ../azee-aztrade-ai origin/fix/audit-gaps-2026-11-10`
3. `cd ../azee-aztrade-ai && git switch -c feature/aztrade-ai-companion`
4. Copy `app/`, `lib/`, and `tests/` from this ZIP into the worktree preserving directories. **Do not copy this README over the repository's existing README.**
5. Set `AZTRADE_AI_COMPANION_ENABLED=true` only in the private development environment, and `AZTRADE_BACKEND_ORIGIN=http://127.0.0.1:4010` for local development. Production gateway requires HTTPS. Keep AZTRADE_PAPER_EXECUTION_CERTIFIED=false and all real-order routing disabled.
6. Existing AZTrade JWT, introspection, AI bridge credentials, PostgreSQL, and mTLS must be configured as already required in the repository. No new auth or subscription service is created.
7. Run `npx vitest run tests/companion-policy.test.ts`, `npx tsc --noEmit`, `npm test`, existing AZTrade backend tests, and desktop/mobile E2E on the actual host. Tests in this package have **not** been executed against the repository.
8. Verify sign-in, logout, token expiry, downgrade, service outage, throttling, cross-account checks and real model calls. A-Zee AI bridge needs its real-model and data-grounding gates. Avoid using temporary test DB outside localhost.

## Architecture notes

- Browser calls A-Zee `/api/aztrade/token` and keeps token in React memory only.
- Browser calls `/api/aztrade/companion?resource=assistant/chat` with that token, not arbitrary upstream URLs.
- A-Zee checks session, tier introspection and strict request allowlist; AZTrade backend revalidates JWT and live session, then obtains tenant-scoped facts and invokes existing A-Zee AI bridge.
- This initial package does not activate licensed prices, broker OAuth, market orders, stop orders, execution strategies or real backtests. They need distinct regulated, licensed and audited projects.
- The user-facing research prompt must not be interpreted as a trade instruction. The AI currently only has paper-account grounding and should explicitly report missing market data.

## Next hardening before public access

- Ensure frontend app shell navigation can link `/aztrade`; this package adds a page, not sidebar edits because the live sidebar structure needs a tested integration diff.
- Ensure backend gateway egress is restricted at network/firewall level to trusted AZTrade service, to mitigate DNS rebinding and internal service spoofing. Use mTLS/service authentication and enforce `AZTRADE_BACKEND_ORIGIN` through a deployment allowlist.
- Provide real broker OAuth via certified partner with encrypted per-user token storage, narrow scopes, disconnect, audit and read-only-by-default; **not implemented**.
- Acquire and verify market-data licensing, provenance, freshness, and permissible use; **not implemented**.
- Real historical engine with market calendars/corporate actions/transaction costs; **not implemented**.
- Add dedicated research quotas and atomic reservation/refunds for new research features, not just the existing `aztrade_assistant` allowance.
- Security audit, privacy assessment, infrastructure test, performance test and legal review are release gates. Never change paper/live execution gates without separate authorization.

**Status: source patch only; NO-GO for public deployment.**
