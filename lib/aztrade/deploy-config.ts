// Startup validation for the identity/introspection service. In production (and any environment named in AZEE_ENV that is
// not "development"/"test") every security setting must be present and sane, otherwise the service must refuse to start.
// Returns a list of problems (names only, never values) so callers can log it safely.

type Env = Record<string, string | undefined>;
const present = (v?: string) => typeof v === "string" && v.trim() !== "";

export function deploymentProblems(env: Env = process.env): string[] {
  const strict = env.NODE_ENV === "production" || (present(env.AZEE_ENV) && !["development", "test"].includes(env.AZEE_ENV!));
  if (!strict) return [];
  const p: string[] = [];
  const need = (name: string, why: string) => { if (!present(env[name])) p.push(`${name}: ${why}`); };

  // Secrets
  if (!present(env.AZEE_SECRET_PROVIDER)) p.push("AZEE_SECRET_PROVIDER: must be set explicitly");
  else if (env.AZEE_SECRET_PROVIDER === "env") p.push("AZEE_SECRET_PROVIDER: the env provider is not allowed outside development/test");
  if (env.AZEE_SECRET_PROVIDER === "file") need("AZEE_SECRETS_DIR", "required for the file provider");
  // Service identity + mTLS
  for (const n of ["AZEE_INTROSPECTION_MTLS_CERT_FILE", "AZEE_INTROSPECTION_MTLS_KEY_FILE", "AZEE_INTROSPECTION_MTLS_CA_FILE"]) need(n, "client mTLS material is required");
  for (const n of ["AZTRADE_MTLS_SERVER_CERT_FILE", "AZTRADE_MTLS_SERVER_KEY_FILE", "AZTRADE_MTLS_CLIENT_CA_FILE"]) need(n, "mTLS listener material is required");
  need("AZTRADE_MTLS_CRL_FILE", "a revocation list is required");
  if (!present(env.AZTRADE_MTLS_ALLOWED_CLIENT_CNS) && !present(env.AZTRADE_MTLS_ALLOWED_CLIENT_FINGERPRINTS)) p.push("AZTRADE_MTLS_ALLOWED_CLIENT_CNS or _FINGERPRINTS: an allowlist of service identities is required");
  need("AZTRADE_SERVICE_SECRET", "service credential is required");
  if (present(env.AZTRADE_SERVICE_SECRET) && env.AZTRADE_SERVICE_SECRET!.length < 32) p.push("AZTRADE_SERVICE_SECRET: must be at least 32 characters");
  // Public exposure
  if (env.AZTRADE_INTROSPECT_ROUTE === "public") p.push("AZTRADE_INTROSPECT_ROUTE: must never be public");
  if (present(env.AZTRADE_MTLS_LISTEN_HOST) && ["0.0.0.0", "::", "[::]"].includes(env.AZTRADE_MTLS_LISTEN_HOST!)) p.push("AZTRADE_MTLS_LISTEN_HOST: bind to a private interface address, not a wildcard");
  // Identity
  if (!present(env.AZEE_JWT_ISSUER) || !/^https:\/\//.test(env.AZEE_JWT_ISSUER!)) p.push("AZEE_JWT_ISSUER: an https:// issuer is required");
  need("AZTRADE_JWT_KID", "signing key id is required");
  // Database: runtime must not use an owner/superuser-looking role, and must differ from the migration role
  const runtimeUrl = env.AZTRADE_DATABASE_URL, ownerUrl = env.AZTRADE_MIGRATION_DATABASE_URL;
  if (!present(runtimeUrl)) p.push("AZTRADE_DATABASE_URL: required (dedicated staging database, runtime role)");
  else {
    const user = safeUser(runtimeUrl!);
    if (!user || ["postgres", "root", "admin", "aztrade_owner"].includes(user)) p.push("AZTRADE_DATABASE_URL: runtime must use a least-privilege role, not an owner/superuser");
    if (present(ownerUrl) && safeUser(ownerUrl!) === user) p.push("AZTRADE_DATABASE_URL: runtime and migration credentials must differ");
    if (/localhost|127\.0\.0\.1/.test(runtimeUrl!) && env.AZEE_ENV === "azee-staging" && !present(env.AZEE_ALLOW_LOCAL_DB)) p.push("AZTRADE_DATABASE_URL: staging must not point at a local development database");
  }
  return p;
}
function safeUser(url: string): string | null { try { return decodeURIComponent(new URL(url).username) || null; } catch { return null; } }

/** Throws (listing setting NAMES only) when a strict environment is misconfigured. Call before opening any listener. */
export function assertSecureDeployment(env: Env = process.env) {
  const problems = deploymentProblems(env);
  if (problems.length) throw new Error(`Refusing to start; insecure or incomplete configuration:\n - ${problems.join("\n - ")}`);
}
