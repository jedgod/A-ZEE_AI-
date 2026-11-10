# Oracle staging: reuse the existing internal Ollama integration (design report, nothing implemented)

Status: **proposal for approval**. Inspected 2026-11-10 (read-only). No model was downloaded, no Ollama was installed or reconfigured, no
external AI provider was added, and no Oracle resource was touched. Production remains NO-GO.

## 1. What already exists (inspected)

| Question | Finding |
|---|---|
| Is Ollama embedded or separate? | **Separate process.** `ollama.exe` 0.40.16 on the developer PC (`C:\Users\jdiabor\AppData\Local\Programs\Ollama`), listening on **127.0.0.1:11434 only**. The A-Zee app reaches it over HTTP via `OLLAMA_BASE_URL`; nothing is embedded in the Next.js process. |
| Installed models | **None.** `ollama list` returns an empty catalog (also recorded in `docs/qorlla-ollama-integration-report.md`). No `OLLAMA_*` variable is set on this machine. |
| Where is the integration? | `05_MODEL_LAYER/ollama_branch/ollama_branch.ts` (native `/api/chat` transport) registered by `lib/pipeline/registry.ts`. The same registry serves web chat (`app/api/chat`, `chat/stream`, `v1/chat`), AZLinqext (`lib/linqext/service.ts`) and the AZTrade AI bridge (`lib/aztrade/ai.ts`), so one configuration covers all three. |
| Configuration | `OLLAMA_ENABLED=true`, `OLLAMA_MODEL` (**exact installed tag, required**), `OLLAMA_BASE_URL` (default `http://127.0.0.1:11434`), optional `OLLAMA_MODEL_DIGEST` (pins the model; a changed digest is refused), `OLLAMA_CONTEXT_TOKENS` (default 32768), `OLLAMA_MAX_OUTPUT_TOKENS` (8192), `OLLAMA_TIMEOUT_MS` (60000). `AZ_PROVIDER_MODE=ollama-only` disables every external provider regardless of keys; `AZ_DISABLED_PROVIDERS` disables providers individually. |
| Safety properties already coded | callers cannot choose the upstream URL; no redirects; remote/cloud model aliases (`remote_host`, `-cloud`) are refused; in `ollama-only` mode the endpoint **must be a numeric loopback address** (no DNS, no remote host); upstream bodies/prompts are never logged. Tests: `tests/ollama.test.ts` (19). |
| Provider routing | additive in `standard` mode (Ollama is one provider among keyed ones, with fallback of up to three); exclusive in `ollama-only` mode (`requireCloudInferenceAllowed()` throws `EXTERNAL_AI_DISABLED` for every cloud adapter). |
| Docker configuration | The A-Zee app has **no** Ollama container. `qorlla-ollama-integration/*/deploy/compose.example.yml` is a separate, **unconnected** gateway candidate (own SQLite/PostgreSQL, `OLLAMA_HOST=0.0.0.0` inside a private network). It is not what the app uses; do not launch it assuming it is. |
| Authentication, plans, accounting | Every route reaches `answerChat` after `requireUser`/plan resolution; usage is **reserved atomically and refunded on failure** (`reserveUsage` in `lib/plans`); AZLinqext and AZTrade AI meter against their own allowances (`linqext_usage`, `aztrade_ai_usage`) with attempt fencing and the supervised recovery worker. **Gap:** token accounting is character-based; Ollama's real token counts are not propagated. No separate `ai.ollama.infer` entitlement exists (existing chat plans apply). |

## 2. Can the existing runtime be reached securely from Oracle staging?

Yes, **without code changes**, but only through a private tunnel that makes the PC's Ollama appear on the Oracle host's **loopback**,
because the existing `ollama-only` rule accepts only a numeric loopback endpoint:

```
Developer PC (Ollama 127.0.0.1:11434)  --ssh -R (outbound, key-restricted)-->  Oracle host 127.0.0.1:11434 (loopback only)
```

* The PC initiates the connection (outbound only); no inbound port on the PC, no port on the Oracle security list, no public exposure of 11434.
* Use a dedicated SSH key with `restrict,port-forwarding,permitlisten="127.0.0.1:11434"` and no shell, run under a supervisor (e.g. autossh/systemd) with keep-alives.
* Alternatives and why not now: WireGuard + a private IP needs the code change the integration report already lists (authenticated allowlist for non-loopback hosts) or a local forwarder; a second Ollama on Oracle is excluded by your instruction.
* **Availability is tied to the PC** being on and the tunnel up; AI replies fail closed otherwise (the app already refuses rather than falling back).

## 3. Recommended deployment topology

```
Internet --443 TLS--> [Oracle VM: reverse proxy (default-deny allowlist)]
                          |  (loopback/private only below this line)
                          +--> A-Zee Next.js app ---> PostgreSQL 16 (private, no public port)
                          |        |  mTLS
                          |        +--> identity listener (/introspect, /jwks)  <--mTLS-- AZTrade API
                          +--> maintenance supervisor (SMTP alerts)
                          +--> 127.0.0.1:11434  <== reverse SSH tunnel <== developer PC: Ollama (model installed with approval)
```
Rules to keep: only 443 (and SSH restricted to your source address) on the OCI security list; PostgreSQL, identity listener, AZTrade API, Ollama never public;
`AZ_PROVIDER_MODE=ollama-only`; **no** external provider keys on the host; `OLLAMA_MODEL_DIGEST` pinned; on the PC keep Ollama bound to loopback and set `OLLAMA_NO_CLOUD=1`.
Search/research/connectors still need an egress audit: `ollama-only` is not whole-application egress isolation (see integration report P0).

## 4. Resource requirements

**Oracle host (measured on the local native stack, light traffic, RSS):** app 155 MB, identity listener 97 MB, AZTrade API 63 MB, maintenance 49 MB,
gateway 56 MB (a Node stand-in; nginx/Caddy would be ~10-20 MB), PostgreSQL 175 MB over 11 processes (with `shared_buffers=96MB`) -> **about 595 MB of services**
plus the OS (~250-350 MB typical) and the tunnel client. Disk: app build output 0.9 GB, `node_modules` 0.5 GB, DB 75 MB plus growth.

* **VM.Standard.E2.1.Micro (1 GB RAM, 1/8 OCPU burstable):** *marginal and not recommended as the only choice.* It would run with almost no headroom; a Next.js build (needs > 2 GB) **must not** run on it (build elsewhere and ship the artifact); add 2-4 GB swap; lower `shared_buffers` (~32-64 MB) and `max_connections`; expect slow cold starts and CPU throttling under load. It cannot host any useful model, which is consistent with keeping Ollama off it.
* **Comfortable minimum for this stack:** 2 vCPU / 4 GB RAM (e.g. an Always-Free Ampere A1 shape if available to you, with ARM builds of every dependency to be verified first: not yet tested).
* **Ollama host (the existing PC):** i5-10400H (4C/8T), 15.6 GB RAM, Intel UHD (no usable GPU), so **CPU-only inference**. The PC often has < 1 GB free RAM with the current workload; a model must fit in free RAM *plus* the context cache. Rough, **unmeasured** planning figures: a ~3B-parameter 4-bit model needs ~2-3 GB RAM and yields single-digit tokens/s on this CPU; a ~7-8B model needs ~5-6 GB and is slower. Model, tag and digest must be chosen by you; **benchmark before relying on it** (the integration report lists capacity/overload controls as open).

## 5. Decisions needed before any implementation
1. Capacity approval for the Oracle shape (E2 Micro marginal vs. a larger shape) and who builds the Next.js artifact.
2. Approved model (exact tag + digest) to install on the PC's existing Ollama, and permission to free RAM on the PC for it.
3. Approval of the reverse-tunnel approach (and which Oracle account/region/source IP restrictions apply).
4. SMTP provider and credentials for alerts (see section 6): none is assumed.

## 6. Alert email (prepared, not enabled)
`scripts/staging/alert-smtp.mjs` sends supervisor alerts over **verified TLS only** (implicit TLS or STARTTLS; no plain text) and does nothing, with exit code 3, until
`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`, `ALERT_MAIL_FROM`, `ALERT_MAIL_TO` (and optionally `SMTP_USER` + `SMTP_PASSWORD_FILE`, `SMTP_CA_FILE`) are provided. Enable with
`ALERT_COMMAND="node scripts/staging/alert-smtp.mjs"` on the maintenance supervisor, which now also logs `alert_delivery_failed` when the command fails or is not configured.
Tested against a fake SMTP server only (`tests/alert-smtp.test.ts`); **no real mail was sent** and no provider was contacted.

## 7. Not done on purpose
No Ollama install or model pull, no external provider or fallback, no Oracle changes, no firewall/tunnel setup, no change to model configuration or application behavior.
