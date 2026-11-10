# azee-staging: provider-neutral deployment specification

**Status: PROPOSED TARGET. No `azee-staging` environment, secret store, internal CA or private network exists.**
Nothing in this repository deploys infrastructure, and nothing here may be reported as deployed or verified.
The hosting provider (cloud, VPS or own servers) is **undecided**; this spec deliberately names no provider, resource or URL.
Production status: **NO-GO**.

## 1. Components

| Component | Specification |
|---|---|
| Environment name | `azee-staging` (convention; set `AZEE_ENV=azee-staging`, which makes the strict startup checks apply) |
| Hosting | Docker-compatible containers first; see `docs/deploy/azee-staging.compose.example.yml` |
| Secrets | Mounted files read through `lib/secrets` (`AZEE_SECRET_PROVIDER=file`, `AZEE_SECRETS_DIR`), populated from a dedicated staging secret store. The store itself is chosen when hosting is chosen; its adapter is added with `registerSecretProvider()` |
| Private network | Isolated container network (`internal: true`) for local staging. Hosted staging needs provider private networking; Docker networking alone is **not** evidence of cloud network isolation |
| mTLS | Internal CA, separate from any public CA. Server cert for the introspection listener, client certs per calling service, CRL published to the listener |
| Public ingress | HTTPS reverse proxy with an explicit route allowlist for user-facing paths only. `/introspect` is never routed |
| Database | Dedicated staging PostgreSQL; runtime role (`aztrade_app`-style, no BYPASSRLS) separate from migration owner and provisioner; no shared credentials with any other environment |
| Service identity | Each caller has its own client certificate (CN/fingerprint allowlisted) **plus** the service credential |

## 2. Startup gate (implemented)
`lib/aztrade/deploy-config.ts` (`assertSecureDeployment`) must run before any listener opens. In production, or whenever
`AZEE_ENV` is not `development`/`test`, it refuses to start unless: an explicit non-`env` secret provider is set; client and
listener mTLS files, a CRL and a client allowlist are present; the service credential is at least 32 characters; the issuer is
https; the signing key id is set; the introspect route is not public and the listener is not bound to a wildcard address;
the runtime database role is least-privilege and differs from the migration role; staging does not point at a local database.
Errors name settings, never values. Tested in `tests/aztrade-deploy-config.test.ts`.

## 3. Network rules
- The introspection listener binds to a private interface only; the public proxy has no route to it and no network path to its port.
- Callers reach it only from the internal network, over mTLS, with the service credential.
- The Next route `/api/aztrade/introspect` is 404 in production unless `AZTRADE_INTROSPECT_ROUTE=private-network`.
- Database is reachable only from the application and the migration job.
- **Verification required (not yet done):** from outside the private network, confirm the listener port and `/introspect` are unreachable through every public address; record the command output as evidence.

## 4. Certificate lifecycle (procedures)

**Issuance.** Generate keys on the host that will use them (never ship private keys through chat, tickets or the repo). Issue
short-lived certificates (target: server 30 days, clients 7-30 days) from the internal CA. Place files in the secret store;
they are mounted read-only into the container. Record serial, CN, fingerprint, owner and expiry in the certificate register.
Add the identity to `AZTRADE_MTLS_ALLOWED_CLIENT_CNS` (or fingerprints).

**Rotation (no downtime).**
1. Issue the new certificate/key; write both to the store as new versions.
2. Server certificate: replace the mounted files; the listener re-reads them every `reloadMs` (default 60 s) and keeps serving
   live connections. Client certificate: replace files; the client agent rebuilds when file times change.
3. Confirm with a test call that presents the new identity, then retire the old certificate (revoke it, step below).
4. Alert when any certificate has less than 25% of its lifetime left; the listener already refuses expired certificates and
   refuses to start with an expired server certificate.
Tested: rotation while 40 concurrent requests are in flight loses none (`aztrade-deploy-negative.test.ts`).

**Revocation.**
1. Revoke on the internal CA, regenerate the CRL, publish it to the mounted CRL file.
2. The listener reloads within `reloadMs`; on a changed CA/CRL it closes idle connections and refuses requests on connections
   authenticated under the old rules, so an already-open keep-alive connection cannot keep working. For an emergency, add the
   fingerprint to the denylist and restart the listener (immediate).
3. If CRL files cannot be refreshed for longer than `maxStaleMs` (default 15 min) the listener answers 503 to everything (fail closed).
4. Verify: a call with the revoked identity is refused; log the check.

**Recovery.**
- *CA key compromise:* treat everything as untrusted. Stand up a new CA, issue new server and client certificates, replace the
  listener's client CA and every client's trusted CA, rotate the service credential and signing keys, restart, and review
  audit logs for the exposure window. Old CA must be removed everywhere.
- *Lost/expired server certificate:* the listener will refuse to start; issue a new one, restart. Callers fail closed meanwhile.
- *Secret store outage:* secrets are cached for a short window then access fails closed (`secret store unavailable`); restore the
  store; no stale value is served past its lifetime.
- *Signing key:* current key plus previous public keys (`AZTRADE_JWT_PREVIOUS_PUBLIC_KEYS`) stay valid for one token lifetime plus
  skew (6 min), then are removed.
- *Backup/restore:* use the dedicated read-only `aztrade_backup` role pattern in `scripts/cert-provision.mjs`; restore into a
  separate database and run the reconciliation checks. Backup storage and restore drills for staging are not yet done.

## 5. Configuration reference (names only)
`AZEE_ENV`, `AZEE_SECRET_PROVIDER`, `AZEE_SECRETS_DIR`, `AZEE_INTROSPECTION_MTLS_{CERT,KEY,CA}_FILE`,
`AZTRADE_MTLS_{SERVER_CERT,SERVER_KEY,CLIENT_CA,CRL}_FILE`, `AZTRADE_MTLS_ALLOWED_CLIENT_{CNS,FINGERPRINTS}`,
`AZTRADE_MTLS_LISTEN_HOST`, `AZTRADE_SERVICE_SECRET`, `AZEE_JWT_ISSUER`, `AZTRADE_JWT_{KID,PRIVATE_KEY,PREVIOUS_PUBLIC_KEYS}`,
`AZTRADE_DATABASE_URL`, `AZTRADE_MIGRATION_DATABASE_URL`, `AZTRADE_INTROSPECT_ROUTE`.

## 6. Not yet built (do not assume)
- A runnable entry point that loads these settings, calls `assertSecureDeployment`, reads secrets through `lib/secrets` and starts
  `createMtlsIntrospectServer` with the real introspection function (the library and tests exist; the launcher does not).
- Internal CA tooling and automated rotation jobs; certificate expiry monitoring; audit-log shipping and alerting.
- A real secret-store adapter, hosted private networking, staging database, and the external-reachability verification in section 3.
