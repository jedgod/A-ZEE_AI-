# AZTrade Step 3: identity, subscriptions and AI integration

## Delivered code

- `azee-identity-integration/identity-router.js`: a mountable A-Zee Express router for 5-minute RS256 tokens, public JWKS, and live-session introspection. The token endpoint MUST be behind existing A-Zee session authentication and CSRF protection. No identity is accepted from request body.
- `backend/lib/identity.js`: AZTrade JWT verifier and per-request live-session introspection. Subscription plan and tenant come from introspection, not token claims.
- `backend/sql/migrations/006_identity_provisioning.sql`: idempotent user, portfolio and paper-account provisioning with tenant-change refusal. Grant execute to the restricted app role explicitly.
- `backend/routes/assistant.js`: a fail-closed A-Zee AI bridge contract; separate `aztrade_assistant` allowance and tenant-scoped PostgreSQL grounding. Market prices are intentionally unavailable until licensed feed certification.

## REQUIRED A-Zee integration before service can run

1. Provide `lookupLiveSession(sid)` that reads A-Zee's actual session store on EVERY mint and introspection request; signing out must invalidate this store immediately. Return `{active,userId,tenantId}`. Fail closed if store unavailable.
2. Provide `lookupSubscription(userId,tenantId)` from authoritative A-Zee billing/entitlements, returning `{plan,status}`; do not trust JWT tier or caller-supplied tier.
3. Mount the issuer router behind A-Zee's existing session middleware and CSRF protections. Protect `/introspect` with private networking, a dedicated rotated service credential, rate limiting and audit; consider mTLS. Mount `/.well-known/jwks.json` publicly.
4. Generate a private RS256 key using an approved secret manager, publish public JWK only, keep `kid` stable per key, support overlapping JWKS keys during rotation (the reference router exposes only the current public key and needs rotation lifecycle before production).
5. Install migration 006 as a separate migration owner. Grant function execute only to restricted app role. Validate RLS, user creation, concurrent duplicate provisioning and tenant-change denial on real PostgreSQL.
6. Implement the A-Zee AI bridge server endpoint: authenticate AZTrade service, verify user+tenant and allowance, atomically meter `aztrade_assistant` separately from regular chat, enforce moderation and PII rules, return `{reply,allowance:"aztrade_assistant"}`. The AZTrade caller alone cannot enforce quota or grounding correctness.
7. Configure `AZEE_AI_BRIDGE_URL`/`AZEE_AI_BRIDGE_TOKEN` over HTTPS. Test AI bridge failures, provider timeouts, forged identity, hallucinated market data, quota exhaustion and session revocation.

## Closure gates

NO-GO until: A-Zee session and billing adapters are wired; keys and credential rotation certified; migrations and RLS proven on PostgreSQL 16; duplicate provisioning and cross-tenant denial verified; logout revokes immediately; subscriptions downgrade immediately; AI quota atomic under concurrency; AI facts sourced from authorized DB only; full integration, load, failure and operational tests pass. This package does not enable live-money trading. Paper-trading certification remains separate.
