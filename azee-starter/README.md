# A-Zee AI backend starter

This is an integration starter, **not a certified production release**. Implemented: authenticated Tavily evidence search, scoped PostgreSQL history, audit events, platform status, and read-only repository file access. Not implemented: LLM answer synthesis, verified claims, cloud IDE, patch writing, agent orchestration, sandbox execution, voice, GitHub/Drive connectors. They are deliberately not simulated.

## Run

1. Install Node.js 22+ and PostgreSQL 16+.
2. `npm install` and `cp .env.example .env` (or create `.env` on Windows).
3. Create the `azee` database and apply `sql/001_init.sql` with `psql`.
4. Configure `DATABASE_URL`, `AUTH_JWKS_URL`, `AUTH_ISSUER`, `AUTH_AUDIENCE`, `CORS_ORIGIN`, and optionally `TAVILY_API_KEY`.
5. `npm run build` and `npm start`.

JWTs must be RS256 signed by your trusted identity issuer and include `sub`, `tenant_id`, `iss`, `aud`, `iat`, and `exp`. Treat tenant claim issuance as a privileged identity-provider operation. Use TLS and network isolation in production. Set `AZEE_REPO_ROOT` and `AZEE_REPO_TENANT` only for a trusted, isolated tenant workspace. This example does not provide per-repository authorization beyond tenant scope, so do not use it for multi-project or untrusted repository hosting without additional controls.

## Security and operational limitations

- Apply database least-privilege grants and tenant isolation/RLS as appropriate before production.
- Add service-level quotas and tenant-scoped rate limiting; current rate limit is process-local.
- Restrict outbound requests, monitor search spend, and redact sensitive search inputs.
- Harden repository file reading against device files, named pipes, very large files, and concurrent symlink replacement before use with untrusted repositories.
- Do not enable arbitrary shell execution in the API process. Use separately deployed microVM/container workers with explicit command policies, no privileged Docker socket, no host filesystem mounts, network isolation, and per-job limits.
- Add CI, integration tests, auth tests, threat modeling, dependency review, backup/restore drills and deployment verification.
