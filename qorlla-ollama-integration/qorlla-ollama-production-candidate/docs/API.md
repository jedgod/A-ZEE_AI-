# Private AI gateway API

All routes except `GET /health/live` and `GET /health/ready` require a bearer token, which the authoritative Qorlla introspection service must validate on **every request**. The readiness endpoint requires `x-health-token`. Tenant and subject are derived only from introspection.

- `GET /health/live` — process health, no authentication.
- `GET /health/ready` — authenticated database readiness; not proof that Ollama is ready.
- `GET /v1/private/models` — tenant-authorized private Ollama models.
- `GET /v1/private/usage` — daily tenant model usage.
- `POST /v1/private/chat` — non-streaming inference. Header `Idempotency-Key: <UUID>`. JSON `{ "model":"private-small", "messages":[{"role":"user","content":"Hi"}] }`.
- `GET /v1/private/requests/:id` — caller-owned request metadata.
- `POST /v1/private/requests/:id/cancel` — mark caller-owned request cancelled; abort in-flight only on same gateway process.

No streaming API is implemented. Do not advertise streaming, cross-node abort propagation, or provider failover as implemented.

## Authoritative introspection adapter

The `AUTHORITY_URL` must accept a service-authenticated POST body `{ "access_token": "...", "required_permission":"ai.ollama.infer" }`, validate Qorlla session and tenant membership and subscription, and return:

`{ "active":true, "session_active":true, "member_active":true, "tenant_active":true, "subscription_active":true, "entitled":true, "tenant_id":"...", "subject_id":"..." }`

**This endpoint is a required Qorlla integration contract, not an endpoint already verified to exist.** Implement/verify against Qorlla's actual auth authority before enabling. Network isolation and mTLS between services remain required in production.
