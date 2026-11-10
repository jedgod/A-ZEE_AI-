# Oracle staging: assessment, runbooks and evidence (2026-11-10)

Scope: planning and local validation only. **Nothing was created, resized, installed, deployed or changed on Oracle**, no tunnel was activated, no mail was sent,
no model was downloaded, and AZTrade was not pushed. Production remains NO-GO.

## 1. Existing Oracle VM (E2 Micro, `azee-oracle`): SSH is broken server-side

Client config (from `~/.ssh/config`): host `148.116.82.70`, user `opc`, port 22, key `~/.ssh/azee-oracle.key`, keep-alive 15 s. `known_hosts` has **no entry** for it (only gitlab.com).

| Probe (read-only, no authentication attempted) | Result |
|---|---|
| TCP connect to :22 (3 attempts) | succeeds in 65-118 ms |
| SSH identification banner | **none within 15 s, 3 of 3** (`Connection timed out during banner exchange`) |
| `ssh-keyscan` | hangs for the same reason (no banner, no key exchange) |
| TCP 80 / 443 | no response |

Interpretation: the network path and the security list are fine for port 22, but **sshd (or the whole VM) is not answering**. Typical causes on a 1 GB E2 Micro, most likely first:
1. the VM is out of memory or CPU-starved (thrashing/swapping, OOM-killed sshd, throttled 1/8 OCPU), so sshd cannot send its banner;
2. sshd is wedged or stuck (for example on reverse DNS lookups, `UseDNS yes`);
3. the instance is mid-boot, hung, or its host has a problem.

**Repair runbook (needs your approval; it touches live infrastructure; I cannot do it from here):**
1. OCI console -> Compute -> Instances -> the E2 Micro: confirm state **Running**; open **Monitoring** (CPU, memory, network) for a saturated or flat-lined pattern.
2. Use a **Console connection** (serial/VNC) to log in locally. Check `free -m`, `uptime`, `dmesg | grep -i -E "oom|killed"`, `systemctl status sshd`, `journalctl -u sshd -n 100`, `ss -tlnp | grep :22`.
3. If memory-starved: stop the memory hogs (`top`), add 2 GB swap, then `systemctl restart sshd`. If sshd is wedged: restart it. If the VM is hung: **soft reboot** from the console (ask first: it interrupts anything running).
4. Set `UseDNS no` in `/etc/ssh/sshd_config` if lookups are slow; confirm `sshd -t` first.
5. **Pin the host key from the console, never from a first connection:** on the VM run `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`, then on this PC add the matching line to a dedicated pinned file and verify the fingerprint equals the console output:
   `ssh-keyscan -t ed25519 148.116.82.70 >> ~/.ssh/azee-oracle.known_hosts` then `ssh-keygen -lf ~/.ssh/azee-oracle.known_hosts`. Keep `StrictHostKeyChecking yes`.
6. Verify: `ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=~/.ssh/azee-oracle.known_hosts azee-oracle true`.

## 2. VM.Standard.A1.Flex (2 OCPU / 12 GB): what must be confirmed in your account

I have no OCI credentials or CLI here, so **eligibility and capacity are NOT verified**. Check in the console (and do not create anything until approved):
* Tenancy is Always Free eligible in the home region, and A1 Flex is offered there. The commonly published Always Free allowance is up to **4 OCPU / 24 GB total** for A1 across instances; 2 OCPU / 12 GB fits inside it. Confirm the current figures in Oracle's Always Free documentation.
* **Regional capacity:** A1 frequently returns "Out of host capacity". Try other availability domains in the home region. You cannot change the home region later.
* **Idle reclamation:** Always Free compute instances can be reclaimed if they stay idle for a long period (Oracle publishes CPU/network/memory thresholds). Confirm the current policy; a staging VM with real services should stay above it, and upgrading the account to Pay-As-You-Go (still free within Always Free limits) is the usual way to remove the risk. **Billing implications are yours to confirm.**
* Boot volume: Always Free includes a limited total block-storage allowance; a 50 GB boot volume is ample for this stack.
* Image: an aarch64 image (Oracle Linux 9 or Ubuntu); the instance must be created with the ARM shape from the start (a shape change from E2 Micro is a re-create, not a resize).

## 3. ARM64 compatibility (verified from the lockfile and registries)

| Item | Result |
|---|---|
| Next.js SWC, `sharp`, `lightningcss`, `@rolldown/binding` | each ships a **linux-arm64** build (glibc and musl variants where applicable) |
| Native addons needing compilation | none among direct dependencies; `pg` is pure JavaScript |
| `postgres:16-alpine`, `node:24-bookworm-slim`, `node:22-bookworm-slim`, `nginx:1.27-alpine` | manifests list **linux/arm64** (queried from the registry) |
| Not yet verified | an actual build and full test run **on an ARM64 machine** (none available here): do this on the A1 before relying on it |

## 4. Resource requirements (measured here; ARM figures will differ)

Measured RSS on the local x64 native stack (light traffic): A-Zee app 155 MB, identity listener 97 MB, AZTrade API 63 MB, maintenance 49 MB, gateway 56 MB, PostgreSQL 175 MB (11 processes, `shared_buffers=96MB`): **~595 MB**. Build output 0.9 GB, `node_modules` 0.5 GB, database 75 MB.
* **E2 Micro (1 GB):** marginal; builds impossible on it; needs swap; not recommended as the staging host.
* **A1 Flex 2 OCPU / 12 GB:** comfortable (roughly 10x memory headroom, room for the Next.js build ~2 GB peak, Docker, monitoring). It could also host a small model later; that is a **separate approval** (you asked to keep Ollama off Oracle for now).

## 5. Ollama: existing integration, model decision, PC assessment

**Reused as is** (05_MODEL_LAYER/ollama_branch + lib/pipeline/registry; no new provider, no second Ollama). Keep `AZ_PROVIDER_MODE=ollama-only`; no external provider or fallback.

**`qwen2.5:1.5b` was NOT downloaded**, because the resource check does not support it safely:
| Check | Finding |
|---|---|
| Disk | **C: has 2.1 GB free of 220 GB** and Ollama's store is `C:\Users\jdiabor\.ollama\models` (empty today, `OLLAMA_MODELS` unset). A 4-bit 1.5B model is roughly 1 GB, which would push C: to ~1 GB free and starve Windows and Docker. E: has 1.78 TB free. |
| RAM | 15.6 GB total, ~2.9 GB available right now (it was 0.4 GB earlier). Firefox ~6.1 GB (46 processes), VS Code ~2.0 GB. A 1.5B model needs roughly 1.5-2.5 GB depending on context. |
| CPU | i5-10400H, Intel UHD only: CPU inference. |

**Cleanup / relocation proposal (nothing was changed; each item needs your yes):**
1. Move the model store off C: by setting the user environment variable `OLLAMA_MODELS=E:\ollama\models`, then restart Ollama (the store is empty, so nothing is lost).
2. Before the first model load, close or restart Firefox (largest consumer) and any unused VS Code windows; do not kill anything automatically.
3. Free space on C: independently (AppData\Local is ~52 GB) so Docker can run later.
After approval: `ollama pull qwen2.5:1.5b`, then record the **actual** digest and metadata (`ollama show qwen2.5:1.5b`, `GET /api/tags`: name, digest, size, parameter size, quantization) into `OLLAMA_MODEL_DIGEST` and your change log. **No digest is invented here.**

**Configuration trap found in the existing integration (documented, not changed):** the provider is only eligible for a request if its `OLLAMA_MAX_OUTPUT_TOKENS` is >= the capability's output budget (chat 2000, code 4000, live search 6000) and its context window covers input + output. Settings that violate this do not fail loudly:
* `OLLAMA_CONTEXT_TOKENS=8192` with the *default* max output (8192) makes the provider config **throw** (limit is context-1) -> the gateway answers a generic `503 SERVICE_UNAVAILABLE`.
* A max output below 2000 gives `403 NOT_PERMITTED / NO_ELIGIBLE_MODEL`.
* A working small development profile (verified against the mock): `OLLAMA_CONTEXT_TOKENS=8192`, `OLLAMA_MAX_OUTPUT_TOKENS=2048`, `OLLAMA_TIMEOUT_MS=60000` (chat only; code/search capabilities need larger limits). The defaults (32768 / 8192) work but allocate a larger context on the CPU box.
Recommendation (not implemented): surface the configuration error in logs instead of a generic 503.

## 6. Egress review: external-provider bypass paths

Every server-side outbound host named in the source is now inventoried in `tests/egress-inventory.test.ts` (a new, unreviewed host fails the test), and a test proves the provider registry builds **only** `ollama` in `ollama-only` mode even when every cloud key is present.

| Path | Hosts | Behaviour in `ollama-only` |
|---|---|---|
| Chat/inference adapters (OpenAI, Gemini, Grok, Anthropic, Groq, Mistral, Together, OpenRouter) | api.* | not registered; adapters throw `EXTERNAL_AI_DISABLED` |
| Input/output moderation | api.openai.com | skipped (gated in `validation.ts`) |
| Web search, pipeline retrieval API, extension hooks | api.tavily.com, `PIPELINE_API_URL` | disabled |
| Connectors | Google Drive/Gmail, GitHub | `EXTERNAL_DATA_DISABLED` |
| Billing / mail | api.stripe.com, api.resend.com | **not AI paths and not gated**; leave unconfigured in staging or allowlist deliberately |
| Display links only | github.com, drive.google.com (search-index) | text, never fetched |

**Recommended host-level egress policy for Oracle staging** (defence in depth; `ollama-only` is application policy, not network isolation): OCI security list/NSG **egress** default-deny, allowing only DNS, NTP, the OS/package mirrors, the Oracle Email Delivery SMTP endpoint (587), and nothing else; no route to any AI provider; the PC tunnel is inbound-initiated from the PC so it needs no egress rule.

## 7. A mistake of mine, found and fixed during this work (please read)

My earlier native-staging notes said provider keys were "blanked" so AI would fail closed. **That was wrong.** On Windows, setting an environment variable to an empty string *removes* it, so Next.js loaded the real keys from `.env.local`. It was caught when a reply request returned a real-looking answer with no Ollama configured. Exposure: while the app ran that way, the only request that could have reached a provider was my own check sending the synthetic text *"Can we meet tomorrow?"* (plus the pipeline's moderation call to OpenAI on that text and the reply): **1-3 external API calls with synthetic text, no user data.** Every other AI request ran under `ollama-only` or was rejected earlier. Fixes: `native-up.ps1` now starts the app with `AZ_PROVIDER_MODE=ollama-only` (external AI disabled by mode, not by blanking), Compose sets the same, and `tests/staging-no-external-ai.test.ts` guards it.
A related earlier claim was also unproven: the E2E check "reply generation fails closed without an AI provider" passed because it accepted *any* 4xx, and the actual response was `403 INVALID_ORIGIN` (the keyboard client must send `X-AZ-Client: mobile`). The check now sends the header and asserts a specific `503`, and passes for the right reason.

## 8. Test evidence

| What | Result |
|---|---|
| AZ_AI vitest (full) | see the final report; new suites: egress inventory (3), no-external-AI guard (3), Ollama health monitor (7), tunnel design (7), SMTP (9) |
| Native staging E2E (`native-verify.mjs`) | all pass, with the corrected reply check |
| AI gateway against the **mock** Ollama (`native-ai-verify.mjs`) | all pass: success path, configured model tag used, idempotent replay (no 2nd call/charge), provider failure/bad JSON/empty/slow -> refused + fully refunded + nothing leaked, changed digest refused *before* any prompt, exhausted allowance refused without reaching the model, free tier cannot obtain extra variants. **The mock performs no inference: this proves integration plumbing, not model quality or capacity.** |
| PostgreSQL 16, A-Zee authentication, subscription enforcement | verified on the native stack (earlier updates) |
| **Docker Compose** | static topology tests only; Docker cannot start on this PC (C: disk). **Not run.** |
| ARM64 execution | **not run** (no ARM machine) |
| Real inference with `qwen2.5:1.5b` | **not run** (model not installed, see section 5) |

## 9. Remaining release blockers
Oracle SSH repair and host-key pinning; A1 eligibility/capacity and an ARM build+test; model install (after the C:/RAM steps) with a recorded digest and a real inference benchmark; tunnel activation (approved security config) and 24/7 availability (the PC must stay on, or Ollama moves to a dedicated host); OCI Email Delivery sender verification and credentials (alerts are prepared, not enabled); Docker runtime and container-isolation tests (disk); egress policy applied in OCI; AZTrade private GitHub repository and commit-scope review; production credentials, licensed market data, billing acceptance, load/security testing, independent review. **Production: NO-GO.**

## 10. Update 2026-11-10 (later): Ollama storage migration attempt and its result

* **Ollama runs as a user process** (`ollama app.exe` tray app + `ollama.exe serve`), not a Windows service. The app keeps its own `settings.models` value in `%LOCALAPPDATA%\Ollama\db.sqlite` and passes it to `serve`, **overriding the `OLLAMA_MODELS` environment variable**. A persistent User variable alone does not move the store; the model location must be changed in the Ollama app's settings, or `serve` must be launched directly with the variable.
* **`E:\ollama\models` was tried and FAILED an integrity check.** E: is a *removable 2 TB card behind a Realtek PCIe card reader* (exFAT, ~20 MB/s write). `qwen2.5:1.5b` (digest reported by Ollama `sha256:65ec06548149b04c096a120e4a6da9d4017ea809c91734ea5631e89f96ddc57b`, Q4_K_M, 1.5B, 940 MB) downloaded and its weights blob hashed correctly **once, from the write cache**; after cache eviction the same file read back with a **different hash**, stable across three reads and a copy to a local drive, and the **manifest read back as 1,020 zero bytes**. The first inference was correct; later inference returned garbage. This is the signature of a fake-capacity or failing card. **Do not store anything important on it; files already on that card may be affected.**
* **The state was restored**: my `OLLAMA_MODELS` User variable was removed, my directly launched `serve` stopped, the normal tray app relaunched (loopback `127.0.0.1:11434`, C: store, empty). The corrupt E: files were left untouched as evidence. Nothing was deleted.
* **Candidate for a retry (needs approval):** `D:` is an internal NVMe NTFS volume (Micron 2200S, healthy, 11.2 GB free); a 304 MB write/read-back test passed, including after forced memory pressure. C: has only ~2 GB free.
* **Gap closed:** the provider's digest pin cannot detect weights corrupted on disk (it compares the identifier Ollama reports). `scripts/staging/verify-ollama-model.mjs` hashes every blob against the manifest and can run a loopback-only smoke question; it flags the E: store (manifest unreadable). The opt-in live test `tests/ollama-live.test.ts` only asserts "non-empty output", so it **passed with garbage**: treat its pass/fail as plumbing, never as quality.
* **Inference performance observed (valid only while the weights were intact):** ~16-18 tokens/s on the i5-10400H (CPU only), model load 1.6 s, ~1.4 GB resident when loaded.
* **Oracle SSH recovered by itself** (banner `SSH-2.0-OpenSSH_9.9` in ~75-90 ms on re-probe) after the earlier banner timeouts. Cause unknown until the console diagnostics (`docs/runbooks/oracle-ssh-diagnostics.md`) are read. Offered host fingerprints (fetched without trusting or pinning; **compare with the console before use**): ED25519 `SHA256:Z6ukUofk6oAe6J1QIPx2InOomK3YMHpKQVPpaLBRLFk`, ECDSA `SHA256:+hLMHA6K2fO6MgvMpTSdMoJNL4V7lLcE6Uqr8jw0B9o`, RSA `SHA256:TdPl/gm2JrejbFoZ9XzfO6TijZUWtFAufo1D2JQIi5o`.
