# Plan: move A-Zee staging to Oracle A1 Flex (2 OCPU / 12 GB)

Status: **plan and prepared script only**. Nothing has been created on Oracle for A1; the VM must be created by the account owner in the OCI console (billing and
Always Free/trial implications are theirs to confirm). The existing E2 Micro stays in service until the A1 host passes the acceptance checks below. Production: NO-GO.

## 0. Why
The E2 Micro (1 GB, 498 MB usable) hit seven OOM kills in one day (see `oracle-staging-assessment.md` sections 11, 11a, 11b). The measured stack needs ~600 MB before the OS and
agents; the Next.js build alone peaks above 2 GB. A1 Flex with 12 GB removes that class of failure.

## 1. Owner actions in the console (cannot be done by the assistant)
1. Check A1 availability and limits (Governance -> Limits, Quotas and Usage, filter A1) in `ca-montreal-1`; try each availability domain if "Out of host capacity".
2. Create `VM.Standard.A1.Flex`, 2 OCPU, 12 GB, **aarch64 Oracle Linux 9**, 50 GB boot volume, your public SSH key, **same VCN/subnet**.
3. Security list for that subnet: **ingress TCP 22 from your own public IP /32 only**; nothing else inbound. Egress: default allow now, then restrict per section 5.
4. Send the new public IP and the host-key fingerprints from **Console history** (Cloud Shell: `oci compute console-history capture ... ; grep -A8 "HOST KEY FINGERPRINTS"`). The assistant pins them in a
   dedicated known_hosts file exactly as was done for the E2 Micro, and verifies with a strict handshake that offers no key.

## 2. Base setup (prepared: `deploy/oracle/a1/bootstrap-a1.sh`, static-tested, NOT yet run)
Refuses non-aarch64, root, a missing/`0.0.0.0/0` SSH range and hosts under 8 GB. Installs Node.js and PostgreSQL 16 from Oracle AppStream, creates the `azee` service account, loopback-only SCRAM PostgreSQL,
firewalld with SSH from `ALLOW_SSH_CIDR` only, sshd hardening (validated with `sshd -t`), 2 GB swap. Always run `DRY_RUN=1` first and keep a second SSH session open.

## 3. Application services (to do after the base is verified)
Reuse the native staging layout (`scripts/staging/native-up.ps1` is Windows-only; Linux systemd units are **not written yet**): identity listener (mTLS, loopback), AZTrade API (loopback), Next.js app (loopback),
maintenance supervisor, reverse proxy with the default-deny allowlist (`deploy/azee-staging-local/gateway/nginx.conf` or the Node gateway) as the only public listener **only when approved**, PostgreSQL via
`scripts/staging/db-bootstrap.mjs` and the AZTrade schema applier, secrets from root-owned files under `/etc/azee/secrets` through the existing provider-neutral file provider.
Ollama stays on the PC and reaches the host only through the restricted reverse tunnel (`deploy/oracle/ollama-tunnel/*`, not activated).

## 4. Acceptance checks on the A1 host (all must pass before cut-over)
| Check | How |
|---|---|
| ARM64 build and tests | `npm ci`, `next build`, `npx vitest run` on the A1 itself; AZTrade `node --test` |
| PostgreSQL 16 certification | **Gap:** the harness `backend/scripts/run-certification.ps1` is PowerShell/Windows-specific; either install PowerShell 7 on the A1 or port it to bash (not done) |
| Isolation | only `22` and (if approved) the proxy port listen publicly; PostgreSQL/identity/AZTrade/Ollama on loopback; `ss -tlnp` evidence recorded |
| Identity/subscriptions/AI | `native-verify.mjs` and `native-ai-verify.mjs` equivalents against the new host (paths and `STAGING_BASE` need a Linux variant: not done) |
| Memory | `free -m` under load; zero OOM lines in `journalctl -k`; build peak recorded |
| Recovery | PostgreSQL restart and service restart tests; backup/restore drill |

## 5. Network egress (after acceptance)
Default-deny egress in the OCI security list/NSG: DNS, NTP, Oracle package mirrors, Oracle Email Delivery SMTP (587) when approved, nothing else; no route to any AI provider.

## 6. Cut-over and rollback
Keep the E2 Micro untouched and running; point nothing at the A1 until section 4 passes; roll back by simply not switching. After cut-over, stop (do not delete) the E2 Micro for a retention period.

## 7. Not verified / not done
ARM execution of any component; A1 capacity and billing; Linux service units; a Linux certification harness; egress policy; any change in the OCI account.
