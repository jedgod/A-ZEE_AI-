import { auditedSecrets, createSecretProvider, hydrate, redact, type SecretProvider } from "@/lib/secrets";
import { assertSecureDeployment } from "./deploy-config";
import { createMtlsIntrospectServer } from "./mtls";

// Launcher logic for the private mTLS /introspect listener. Everything secret comes through the provider-neutral secret
// interface; certificate paths are plain configuration (the files are mounted, and re-read by the listener for rotation).

export const SECRET_NAMES = ["AZTRADE_SERVICE_SECRET", "AZTRADE_JWT_PRIVATE_KEY", "AZTRADE_JWT_PREVIOUS_PUBLIC_KEYS", "AZTRADE_DATABASE_URL"] as const;
type Env = Record<string, string | undefined>;
export type JwksFn = (env: Env) => Promise<unknown>;
export type IntrospectFn = (token: string, env: Env) => Promise<unknown>;

const list = (v?: string) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/** The real introspection: A-Zee's live session store + billing. Imported lazily so DATABASE_URL is set before the pool is created. */
let guarded = false;
/** A database restart makes idle pooled connections emit 'error'. Without a listener Node treats that as fatal and the identity
 *  service dies (AZTrade then fails closed forever). With one, pg discards the dead client and reconnects on the next query. */
async function guardPool(log: (e: Record<string, unknown>) => void = () => {}) {
  if (guarded) return; guarded = true;
  const { pool } = await import("@/lib/admin/db");
  pool.on("error", (e: Error & { code?: string }) => console.error(JSON.stringify({ type: "db_pool_error", code: e.code ?? "UNKNOWN" })));
  log({ type: "db_pool_guard_installed" });
}
async function realJwks(env: Env) { process.env.DATABASE_URL = env.AZTRADE_DATABASE_URL; await guardPool(); const { aztradeConfig, jwksFor } = await import("./identity"); return jwksFor(aztradeConfig(env)); }
async function realIntrospect(token: string, env: Env) {
  process.env.DATABASE_URL = env.AZTRADE_DATABASE_URL;                     // the A-Zee pool reads DATABASE_URL at import time
  await guardPool();
  const { aztradeConfig, introspect } = await import("./identity");
  return introspect(token, aztradeConfig(env));
}

export async function startListener(opts: { env?: Env; provider?: SecretProvider; introspect?: IntrospectFn; jwks?: JwksFn; port?: number; log?: (e: Record<string, unknown>) => void } = {}) {
  const env = opts.env ?? process.env;
  const log = opts.log ?? ((e) => console.info(redact(JSON.stringify(e))));
  const secrets = auditedSecrets(opts.provider ?? createSecretProvider(env), (e) => log({ type: "secret_access", ...e }));
  const initial = await hydrate([...SECRET_NAMES], secrets, env);
  assertSecureDeployment(initial, "listener");                                         // refuses to open a socket when anything is missing/unsafe
  const serviceSecret = initial.AZTRADE_SERVICE_SECRET!;
  const introspect = opts.introspect ?? realIntrospect;

  const service = await createMtlsIntrospectServer({
    keyFile: env.AZTRADE_MTLS_SERVER_KEY_FILE!, certFile: env.AZTRADE_MTLS_SERVER_CERT_FILE!,
    clientCaFile: env.AZTRADE_MTLS_CLIENT_CA_FILE!, crlFile: env.AZTRADE_MTLS_CRL_FILE,
    allowedClientCommonNames: list(env.AZTRADE_MTLS_ALLOWED_CLIENT_CNS), allowedClientFingerprints: list(env.AZTRADE_MTLS_ALLOWED_CLIENT_FINGERPRINTS),
    deniedClientFingerprints: list(env.AZTRADE_MTLS_DENIED_CLIENT_FINGERPRINTS),
    serviceSecret, reloadMs: Number(env.AZTRADE_MTLS_RELOAD_MS) || 30_000, maxStaleMs: Number(env.AZTRADE_MTLS_MAX_STALE_MS) || 15 * 60_000, log,
    // Re-read secrets per call (short cache) so a rotated signing key / service credential applies without a restart.
    jwks: async () => (opts.jwks ?? realJwks)(await hydrate([...SECRET_NAMES], secrets, env)),
    introspect: async (token) => introspect(token, await hydrate([...SECRET_NAMES], secrets, env)),
  });
  const port = await service.listen(opts.port ?? Number(env.AZTRADE_MTLS_PORT ?? 8443), env.AZTRADE_MTLS_LISTEN_HOST!);
  log({ type: "introspect_listener_started", port });
  return { ...service, port };
}
