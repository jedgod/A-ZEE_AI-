# Qorlla Private Ollama Gateway — integration candidate

**Status: NOT PRODUCTION CERTIFIED.** This is a runnable reference gateway, not a completed integration into the existing Qorlla authentication, subscription, Shield or Workspace systems.

## Included
- Ollama-only private inference route with strict model allowlist.
- JWKS-verified service JWT (`tenant_id`, `scopes: ["ai:private:infer"]`), issuer and audience checks.
- PostgreSQL atomic per-tenant daily request quota.
- No external AI fallback; strict input limits, timeout, concurrency cap, and safe errors.
- Private-network Docker Compose example and minimal tests.

## Local test
`npm install && npm test && npm run check`

## Deploy integration checklist
1. Coordinate with the sole writer for the Qorlla repository. Do not edit the Docs worktree concurrently.
2. Review code against the actual Qorlla portal/Shield auth contract; dedicated service JWT must only be minted by a trusted backend after checking active tenant membership, suspension, MFA where required, and `ai.private` plan entitlement. This reference gateway does **not** perform those live checks itself.
3. Run migration with a dedicated least-privilege DB role; use separate gateway database credentials and verified TLS CA trust.
4. Pin container images by digest; provision approved model weights in a controlled process and verify checksums/licenses.
5. Add gateway service to Qorlla's existing private network; enforce network egress deny for inference container and ensure JWKS is accessible only as needed. Keep Ollama port private.
6. Wire the existing provider-neutral Qorlla AI gateway to this service as an additional provider; do not remove existing providers. Preserve private-only routing policy and block external fallback.
7. Implement persistent, crash-safe distributed concurrency leases, rate limiting, idempotency, full usage billing, cancellation, and output safety controls before public rollout.
8. Perform real model tests, failover/restart, outage, token forgery, tenant isolation, load, privacy egress, and rollback certification.

## Known limitations requiring work before production
- Gateway trusts a service JWT with tenant scope; live subscription and membership must be enforced by Qorlla's issuing service.
- In-memory concurrency counter is per process and not distributed.
- Daily quota reserves requests and refunds on failure, but a crash can consume a quota unit; quota accounting is not full token-based billing.
- No streaming endpoint, prompt-injection defense, RAG, content moderation, distributed metrics, or complete deployment manifests.
- Readiness checks DB but not live model availability.
- Example Compose requires provisioning secrets, network, model, GPU and TLS; it is not plug-and-play production.

## Expanded database and API design artifacts

- `deploy/002_ai_platform_postgres.sql`: additive provider/model registry, tenant entitlements, inference request accounting, daily usage and audit tables for PostgreSQL.
- `deploy/sqlite/002_ai_platform_sqlite.sql`: corresponding local SQLite schema. SQLite is for local/single-process development, not shared production deployments.
- `docs/API_CONTRACT.md`: proposed application API endpoints, including a clear distinction between implemented gateway routes and unimplemented production features.

**Do not treat these new schemas or API specifications as a completed backend.** They have not been applied to the Qorlla database or wired to its existing subscription system.
