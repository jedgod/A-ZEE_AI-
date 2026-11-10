# Proposed Qorlla AI API contract (NOT implemented by this reference gateway)

The current runnable gateway implements GET /health/live, GET /health/ready,
GET /v1/private/models, and POST /v1/private/chat with service JWT verification.
The following endpoints are design contracts for integration, not functioning routes.

| Method | Path | Responsibility |
|---|---|---|
| GET | /api/v1/ai/models | Tenant-filtered model registry |
| POST | /api/v1/ai/chat | Non-streaming completion; idempotency key |
| POST | /api/v1/ai/chat/stream | SSE with cancellation and bounded buffering |
| GET | /api/v1/ai/usage | Tenant-scoped usage and limits |
| GET | /api/v1/ai/conversations | Tenant-scoped conversation list |
| POST | /api/v1/ai/conversations | Create conversation |
| DELETE | /api/v1/ai/conversations/:id | Delete conversation and retention metadata |
| GET | /api/v1/admin/ai/providers | Privileged provider health/configuration |
| PATCH | /api/v1/admin/ai/models/:id | MFA-protected model enablement |

Do not accept tenant_id, subject_id, or plan from request JSON; derive from verified
Qorlla identity and active membership. Apply server-side entitlements before model routing.
Use private-only routing for protected Qorlla Workspace data, with no cloud fallback.
Store prompt/response text only with an explicit retention policy and user consent.
Do not expose Ollama's native API publicly. Model inventory is an allowlist, not an
arbitrary user-supplied model name.

Production work still required: real Qorlla auth and entitlement adapter, idempotent
transactional reservations and token reconciliation, multi-instance capacity control,
streaming/cancellation, tenant isolation, monitoring, incident response, secrets rotation,
real-model performance and network-egress certification, and integration E2E tests.
