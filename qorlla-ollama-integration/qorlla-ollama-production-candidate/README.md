# Qorlla Ollama Private AI Gateway — Integration Candidate v0.3.0

**Release verdict: NO-GO for production.** This is a complete, downloadable source folder for an independently runnable *integration candidate*, not a claim that the current Qorlla deployment has been integrated or certified.

## Scope

- Ollama is **additive**. No existing OpenAI/Gemini/xAI provider adapter is changed or removed.
- Authenticated REST API: private model catalog, usage, chat, request status and cancellation.
- PostgreSQL production-target adapter with transactional quota admission, tenant concurrency counters, idempotency, lease heartbeats and fencing.
- SQLite single-host development adapter with analogous admission semantics.
- Private Docker deployment example, migration scripts, authority adapter and unit tests.
- No prompt or model response content is stored in request/audit tables, except the completed response in `response_json` for idempotent replay. **This response retention is sensitive and needs a production retention/encryption policy before activation.**

## Files

```
qorlla-ollama-production-candidate/
  src/{server,app,auth,store,ollama}.mjs
  sql/{001_postgres,002_postgres,001_sqlite}.sql
  tests/{store,auth,ollama}.test.mjs
  deploy/{Dockerfile,compose.example.yml}
  docs/API.md
  .env.example
  package.json
```

## Local SQLite quick start

Requires Node.js >=22.13 and npm. Use a dedicated temporary database.

```bash
npm install
node -e "const {DatabaseSync}=require('node:sqlite');const fs=require('node:fs');const db=new DatabaseSync('qorlla-ai.sqlite');db.exec(fs.readFileSync('sql/001_sqlite.sql','utf8'));db.close()"
# Provision a provider, model, tenant entitlement and tenant concurrency limit.
# Example development seed (NEVER use this as a production entitlement authority):
node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('qorlla-ai.sqlite');d.exec(\"INSERT INTO ai_provider_registry(provider_id,kind,enabled,private_only) VALUES('ollama','ollama',1,1);INSERT INTO ai_model_registry(model_id,provider_id,upstream_model,enabled,max_output_tokens) VALUES('private-small','ollama','qwen2.5:0.5b',1,512);INSERT INTO ai_tenant_model_entitlements(tenant_id,model_id,daily_request_limit,daily_token_limit) VALUES('dev-tenant','private-small',20,10000);INSERT INTO ai_tenant_limits(tenant_id,max_concurrent) VALUES('dev-tenant',2)\");d.close()"
npm run check
npm test
```

A running API additionally requires an authoritative Qorlla-compatible introspection endpoint, even for local development. **Do not use a permissive mock introspection endpoint with real data.** Set environment variables from `.env.example`, with `OLLAMA_ENABLED=false` initially. Start using `npm start`.

## PostgreSQL deployment

1. Back up and restore-test a **disposable copy** of the actual Qorlla database.
2. Review namespace collisions and Qorlla's actual schema/migration naming. These tables use `public.ai_*` by default, not Qorlla's `portal` schema. Adapt and test with the real schema before applying.
3. Apply `sql/001_postgres.sql`, then `sql/002_postgres.sql` under a migration role in a disposable PostgreSQL 16+ instance.
4. Provision a restricted runtime DB role with access only to the gateway tables. Apply role grants explicitly; these SQL files **do not** create a production-ready role/grant policy.
5. Seed model/provider records and tenant entitlements through a controlled administrative process; do not trust caller-supplied entitlements.
6. Configure `DATABASE_URL`, `AUTHORITY_URL`, `AUTHORITY_SERVICE_TOKEN`, `HEALTH_TOKEN`, `OLLAMA_BASE_URL`, and set `OLLAMA_ENABLED=false`.
7. Pin the Ollama image to an approved immutable digest, provision model weights with verified provenance, and configure GPU capacity and private networking.
8. Validate actual session revocation, subscription suspension, privacy routing, PostgreSQL concurrency, real inference, monitoring, backup and rollback before enabling the flag.

## Request state and recovery policy

`running -> completed | failed | cancelled | recovery_required`.

Each request receives an owner UUID, a fencing epoch and a lease expiration. Completion requires the matching live lease. A lease expiration transitions to `recovery_required` on the next reservation or maintenance call; it releases concurrency capacity but **retains token reservation**, since execution may have happened. Operators must reconcile these requests; the system intentionally does **not** auto-retry ambiguous inference. A background recovery scheduler is not provided.

Idempotent completed requests return their stored response; other repeated keys return conflict. Cross-process cancellation marks the database state but cannot immediately abort an Ollama HTTP request executing on a different gateway node. The stale completion is rejected. Distributed cancellation signaling is a production gap.

Daily quota admission uses a character-based upper-bound estimate, **not a model tokenizer**. Actual reported tokens may exceed it. Production must use a validated model-specific token budget and output enforcement policy. The gateway does not implement streaming.

## Tests executed in this package

- `npm run check`: passed.
- `npm test`: 5/5 passed using SQLite and a stubbed Ollama HTTP response.
- PostgreSQL integration tests: **not executed** (no PostgreSQL service available in this environment).
- Real Ollama inference: **not executed** (no Ollama service/model available in this environment).
- Real Qorlla auth/subscription integration: **not executed** (requires actual authority contract and repository).
- Multi-instance, cross-network TLS, security penetration, load and rollback: **not executed**.

## Critical remaining GO blockers

1. Adapt and implement the Qorlla authoritative introspection contract, including session revocation, live membership and subscriptions. Existing Qorlla endpoints have not been verified to match `docs/API.md`.
2. Integrate with the actual Qorlla provider router and protect Workspace data from unauthorized external fallback.
3. Production database grants, RLS/tenant isolation review, encrypted retention and deletion for replay payloads, migrations/rollback on real schema.
4. Durable recovery scheduler, multi-instance concurrency/cancel tests, per-model tokenizer admission, overload protection, worker scheduling and bounded queueing.
5. Real Ollama streaming if the Qorlla UX requires it, health/readiness for the actual model, pinned image/model artifacts, monitoring and alerts.
6. Integration and failure-injection tests with PostgreSQL, Ollama, real Qorlla sessions and subscription authority.
7. Staging deployment, independent security review, load tests and rehearsed rollback.

**Do not deploy this package as production GO without completing these blockers.**
