# Qorlla Ollama integration report

Assessment date: November 8, 2026.

## Outcome

Native provider integration implemented in the root application. Live activation
and production readiness remain incomplete. The existing Ollama installation
responded to `ollama list` with an empty model catalog. No model download or
production configuration change was made.

| Area | Implemented / observed |
|---|---|
| Inference | Native `/api/chat` transport based on production candidate; system/history messages, bounded output, configured context, timeout, cancellation, no redirects, generic error logging |
| Routing | Explicit enable flag, required installed model tag, disabled-provider support, standard additive mode and exclusive Ollama mode |
| Qorlla integration | Shared registry used by existing pipeline; existing authentication, plan metering, validation and reporting apply |
| Reports | Ollama included in existing admin provider statistics and model-performance records when configured and called |
| Data | No new database tables or standalone replay storage; existing Qorlla chat storage still applies |
| UI delivery | Existing post-validation SSE delivery; native provider-token streaming not implemented |
| Source selection | Production candidate transport ported to TypeScript; other snapshots retained unchanged |

## Gaps and next actions

| Priority | Gap | Required next action |
|---|---|---|
| P0 activation | Ollama has no installed model | Install an approved model, configure its exact tag and supported limits, restart and exercise authenticated Qorlla chat |
| P0 private deployment | Exclusive inference mode is not whole-application egress isolation | Audit search, research, tools and connectors; enforce network egress policy and validate with sensitive-data test fixtures |
| P1 authorization | No distinct `ai.ollama.infer` tenant entitlement in native path | Decide whether existing chat plans suffice; add dedicated entitlement only if the product requires it |
| P1 quality/capacity | No model evaluation, memory sizing, throughput or overload evidence | Benchmark chosen hardware/model, validate code/tool/JSON behavior, add admission and capacity controls |
| P1 budgets | Existing character-based token estimates and metadata; adapter contract does not carry actual Ollama token usage | Add model-specific token accounting and usage propagation before token-based billing |
| P1 routing | Standard fallback uses at most three providers; broader existing router does not recheck every fallback model's context eligibility | Test mixed-model budgets and implement per-attempt eligibility before relying on heterogeneous fallbacks |
| P1 health | Registration proves configuration, not model readiness | Add protected model-readiness checks and alerting; validate unavailable/missing-model behavior in staging |
| P1 security | Endpoint is operator-configured, with no native proxy authentication configuration | Use private networking; add authenticated TLS proxy support if crossing trust boundaries |
| P1 verification | Real Qorlla browser/IDE + live model round trip not exercised | Validate auth, limits, cancellation, outage and reports with the selected model |
| P2 streaming | Ollama buffers completion | Evaluate streaming requirements against existing validate-before-delivery policy |

## Standalone gateway status

The production candidate remains a separate, unconnected service. Its authority
contract expects session, tenant, subscription and permission introspection; root
Qorlla does not provide that adapter as part of this change. Its SQL is not in the
root migration runner. Do not launch it assuming the native provider uses it.

Its documented production gaps remain: PostgreSQL concurrency/isolation tests,
runtime grants, replay-response retention/encryption/deletion, recovery scheduling,
distributed cancellation, tokenizer budgets, load/security review and rollback.
The current default Node executable is v20.19.0; its SQLite implementation requires
Node >=22.13. The native HTTP adapter does not require `node:sqlite`.

## Verification

| Check | Result |
|---|---|
| `npm run typecheck` | Passed |
| Focused Ollama + pipeline tests | 34 passed |
| Full root Vitest regression suite | 36 files, 267 tests passed |
| Standalone candidate authority and transport tests | 2 passed, executed directly with Node |
| `git diff --check` | Passed (line-ending notices only) |
| `ollama list` | Service responded; zero installed models |
| Standalone SQLite/PostgreSQL store integration | Not executed; default Node 20 lacks required SQLite runtime, no disposable PostgreSQL fixture prepared |
| Production build / browser end-to-end / live inference | Not executed |

The initial sandboxed Vitest launch failed because Windows child-process creation
was blocked (`spawn EPERM`); the authorized retry passed. Standalone transport and
authority tests ran directly without child-process isolation. Tests use mocked
inference; they cannot establish model quality or production readiness.
