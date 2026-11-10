import { readFile, stat } from "node:fs/promises";
import path from "node:path";

// Provider-neutral secret access. Application code asks for a secret by NAME and never knows where it lives.
//
//   AZEE_SECRET_PROVIDER = env | file | <a kind registered with registerSecretProvider()>
//   AZEE_SECRETS_DIR     = directory holding one file per secret (the "file" provider; works with any orchestrator that
//                          mounts secrets as files, so no vendor is assumed)
//
// Real staging/production stores plug in through registerSecretProvider(). Nothing here names a cloud, URL or resource.
// Rules: values are never logged; every read is audited by name + outcome only; production never falls back to env.

export type SecretProvider = {
  readonly kind: string;
  /** Returns the current value, or null if the secret does not exist. Throws on access failure (fail closed). */
  get(name: string): Promise<string | null>;
};
export type SecretAudit = (event: { at: string; provider: string; name: string; outcome: "hit" | "miss" | "error"; actor?: string }) => void;

export class SecretError extends Error { constructor(message: string) { super(message); this.name = "SecretError"; } }

const NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/;
const assertName = (name: string) => { if (!NAME.test(name)) throw new SecretError("invalid secret name"); };

export function envProvider(env: Record<string, string | undefined> = process.env): SecretProvider {
  return { kind: "env", async get(name) { assertName(name); const v = env[name]; return v === undefined || v === "" ? null : v; } };
}

/** One file per secret inside `dir`. Names cannot escape the directory; world-readable files are refused on POSIX. */
export function fileProvider(dir: string): SecretProvider {
  const root = path.resolve(dir);
  return {
    kind: "file",
    async get(name) {
      assertName(name);
      const file = path.join(root, name);
      if (path.dirname(file) !== root) throw new SecretError("invalid secret name");
      let info;
      try { info = await stat(file); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw new SecretError("secret store unavailable"); }
      if (!info.isFile()) throw new SecretError("secret is not a file");
      if (process.platform !== "win32" && (info.mode & 0o004) !== 0) throw new SecretError("secret file is world-readable");
      return (await readFile(file, "utf8")).replace(/\r?\n$/, "");
    },
  };
}

const factories = new Map<string, (env: Record<string, string | undefined>) => SecretProvider>();
/** Adapters for the real staging/production stores register here once the provider is confirmed from infrastructure. */
export function registerSecretProvider(kind: string, factory: (env: Record<string, string | undefined>) => SecretProvider) {
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(kind) || kind === "env" || kind === "file") throw new SecretError("invalid provider kind");
  factories.set(kind, factory);
}

export function createSecretProvider(env: Record<string, string | undefined> = process.env): SecretProvider {
  const kind = env.AZEE_SECRET_PROVIDER || (env.NODE_ENV === "production" ? "" : "env");
  if (!kind) throw new SecretError("AZEE_SECRET_PROVIDER must be set explicitly in production");
  if (kind === "env") {
    if (env.NODE_ENV === "production") throw new SecretError("the env provider is not allowed in production");
    return envProvider(env);
  }
  if (kind === "file") {
    if (!env.AZEE_SECRETS_DIR) throw new SecretError("AZEE_SECRETS_DIR is required for the file provider");
    return fileProvider(env.AZEE_SECRETS_DIR);
  }
  const factory = factories.get(kind);
  if (!factory) throw new SecretError(`secret provider "${kind.slice(0, 32)}" is not registered`);   // unknown store: never guess
  return factory(env);
}

/** Wraps a provider with auditing (names and outcomes only) and a short per-process cache so rotation is picked up in seconds. */
export function auditedSecrets(provider: SecretProvider, audit: SecretAudit = defaultAudit, ttlMs = 30_000, now = () => Date.now()) {
  const cache = new Map<string, { value: string; at: number }>();
  async function get(name: string, actor?: string): Promise<string | null> {
    const hit = cache.get(name);
    if (hit && now() - hit.at < ttlMs) return hit.value;
    try {
      const value = await provider.get(name);
      audit({ at: new Date(now()).toISOString(), provider: provider.kind, name, outcome: value === null ? "miss" : "hit", actor });
      if (value === null) { cache.delete(name); return null; }
      cache.set(name, { value, at: now() });
      return value;
    } catch (e) {
      audit({ at: new Date(now()).toISOString(), provider: provider.kind, name, outcome: "error", actor });
      throw e instanceof SecretError ? e : new SecretError("secret store unavailable");   // never forward provider messages that could carry values
    }
  }
  async function require(name: string, actor?: string): Promise<string> {
    const value = await get(name, actor);
    if (value === null) throw new SecretError(`required secret ${name} is missing`);
    return value;
  }
  return { get, require, invalidate: (name?: string) => (name ? cache.delete(name) : cache.clear()) };
}
const defaultAudit: SecretAudit = (event) => console.info(JSON.stringify({ type: "secret_access", ...event }));

/** Fills a config record (shaped like process.env) from the provider so existing loaders such as aztradeConfig() keep working. */
export async function hydrate(names: string[], secrets: ReturnType<typeof auditedSecrets>, base: Record<string, string | undefined> = process.env) {
  const out: Record<string, string | undefined> = { ...base };
  for (const name of names) { const v = await secrets.get(name, "hydrate"); if (v !== null) out[name] = v; }
  return out;
}

const SENSITIVE = /(-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----|bearer\s+[A-Za-z0-9._~+/=-]{8,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*)/gi;
/** Scrubs private keys, bearer credentials and JWTs from any string before it is logged. */
export const redact = (text: string) => text.replace(SENSITIVE, "[redacted]");
