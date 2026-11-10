# Qorlla Ollama provider gateway v2 — integration candidate, NOT production certified

This is an isolated, additive Ollama adapter. It does not replace OpenAI, Gemini, xAI, or Qorlla's existing provider router. Do **not** deploy it as a replacement for Qorlla authentication, subscription enforcement, or existing AI APIs.

## Implemented
- Authenticated REST endpoints: `GET /health/live`, `GET /health/ready`, `GET /v1/private/models`, `GET /v1/private/usage`, `POST /v1/private/chat`.
- Signed JWT verification via issuer/JWKS/audience, with a dedicated `ai:private:infer` scope.
- PostgreSQL and SQLite adapters for tenant-scoped model discovery, per-model entitlements, atomic daily request/token reservations, request idempotency, completion/refund, usage summaries.
- PostgreSQL transactional advisory locking serializes reservations across nodes for the same tenant/model; SQLite uses `BEGIN IMMEDIATE` for single-host local use.
- Only the private Ollama provider is accepted in this service; no external fallback.
- Ollama HTTP adapter from earlier package; bounded inputs, model registry allowlist, timeout.

## Setup (isolated development only)
1. Node 22+, `npm install` (lock and pin exact versions before release).
2. PostgreSQL: apply `deploy/postgres.sql` in an isolated database, or SQLite: create the database using `deploy/sqlite.sql` with a SQLite CLI. Do not apply these migrations to Qorlla's live schema until reviewed against existing migrations.
3. Seed `ai_provider_registry`, `ai_model_registry`, and `ai_tenant_model_entitlements` for a test tenant. Provider `kind='ollama'`, `private_only=true`/`1`, enabled. Use an actual installed upstream Ollama model.
4. Set `DATABASE_URL` **or** `SQLITE_PATH`; `JWKS_URL`, `JWT_ISSUER`, `JWT_AUDIENCE`, `OLLAMA_BASE_URL`, and `OLLAMA_ENABLED=true`. Run `npm start`.
5. The calling Qorlla service must supply a valid signed JWT with `sub`, `tenant_id`, and `scopes` including `ai:private:infer`. Supply a UUID `Idempotency-Key` on POST.

Example POST body: `{"model":"small","messages":[{"role":"user","content":"Hello"}]}`.

## Production blockers — mandatory
- **Qorlla integration missing:** Replace JWT-claim-only trust with live session, organization membership, suspension, and actual subscription checks. Use Qorlla's existing authoritative tenant mapping, not user-supplied tenant IDs. No Qorlla repo was accessible here.
- **Reservation recovery missing:** In-flight reservations left by process termination need a lease/heartbeat/reaper and deterministic recovery. Retries currently return 409 and do not replay a prior response. Financial/usage effects require certification.
- **Token budget:** `Math.ceil(chars/2)+1024` is a conservative *heuristic*, not a provable upper bound on actual tokenizer usage; reconcile and enforce actual token caps using provider-specific tokenization and maximum context. Never bill actual usage as final until validated.
- **Concurrency:** In-memory active limit is per instance only. Implement shared Redis/DB semaphores or a scheduler with distributed leases, load shedding and crash recovery before horizontal scale.
- **No streaming/cancellation endpoint** and no durable conversation storage; implement separately if needed.
- **Model identity and SSRF:** Validate private Ollama endpoint with network policy/mTLS, restrict DNS and egress, disallow arbitrary model names and user-supplied URLs.
- **Schema conflicts:** These `ai_*` tables are illustrative; inspect the actual Portal and subscription migrations, existing role grants, tenant keys, and schema names. Add versioned additive migrations with rollback.
- **Security:** Strict transport security, workload identity, secrets manager, audit trail, alerts, per-user rate limiting, payload classification, no prompts in logs, model supply-chain provenance, patching, retention and deletion policies.
- **Operational tests:** Real PostgreSQL integration and concurrent multi-node tests, real Ollama GPU inference, failure injection, PostgreSQL restart recovery, browser/mobile integration, private-egress proof, backup/restore, rollback, load tests and independent security review.
- **SQLite:** Node 22 `node:sqlite` is experimental and should remain local/test-only; never share SQLite files between production hosts.

## Validation here
- `node --test test/*.test.mjs`: 2/2 SQLite store tests passed on Node 22.16.0.
- `npm run check`: syntax passed.
- Dependencies were not installed in this environment. API server, PostgreSQL adapter, and real Ollama integration were **not** executed or certified.
- No Qorlla repository files, database, container, or branch were modified.

## Release verdict
**NO-GO** until the above gates are closed with evidence.
