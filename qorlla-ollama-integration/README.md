# Ollama in Qorlla

The root Qorlla Next.js application now has a native Ollama provider in
`05_MODEL_LAYER/ollama_branch/ollama_branch.ts`, ported from the production
candidate's non-streaming transport. It uses the existing pipeline, account and
plan checks, validation, cancellation, provider health and admin reports.

The four subdirectories are standalone source snapshots. They are not services
started by the root application. The `qorlla-ollama-production-candidate` is the
reference for the native adapter; its database, quota, authority and replay
subsystems are not activated. Do not apply its SQL to the application database
to use the native provider.

## Configure the root application

Install an approved model in the local Ollama service first. `ollama list` must
show the exact tag you configure. Add these settings to root `.env.local`:

```dotenv
OLLAMA_ENABLED=true
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=<exact-installed-model-tag>
OLLAMA_CONTEXT_TOKENS=32768
OLLAMA_MAX_OUTPUT_TOKENS=8192
OLLAMA_TIMEOUT_MS=60000
AZ_PROVIDER_MODE=ollama-only
```

Choose context/output limits supported by that model and the host's memory.
Restart Qorlla. The existing browser and IDE chat routes use the provider;
the admin provider report and Insights record its attempts and latency. An
enabled provider means configured, not health-verified. No API key is required.

`AZ_PROVIDER_MODE=standard` (the default) retains cloud providers and adds Ollama
at the end of their priority order. Existing routing tries at most three providers,
so Ollama may not be attempted when several cloud providers are configured.
`AZ_CODE_PROVIDERS=ollama,groq,gemini` can prioritize it for code mode.

`ollama-only` removes all cloud providers from this shared registry, including
fallback, and uses the existing local safety filter instead of OpenAI moderation.
If Ollama is disabled/unavailable, it does not substitute cloud inference.
Leave `CHAT_DEMO_MODE` disabled for operational checks. This setting is **not an
application-wide offline/privacy guarantee**: search, connectors and other network
features remain separately configured. The registry conservatively classifies
the server-configured HTTP endpoint as external; internal/public classifications
are unchanged. Never expose an unauthenticated Ollama port publicly.

Disable with `OLLAMA_ENABLED=false` or add `ollama` to `AZ_DISABLED_PROVIDERS`.
To return to cloud routing, also set `AZ_PROVIDER_MODE=standard`.
No database rollback is needed for this native adapter.

See [integration report and gaps](../docs/qorlla-ollama-integration-report.md).
