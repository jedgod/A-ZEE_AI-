#!/usr/bin/env node
// Generates the DISPOSABLE secrets for azee-staging-local into a git-ignored directory (default secrets-staging/).
// One file per secret; the file name is the secret name read by lib/secrets (file provider) and mounted at /run/secrets/<name>.
// Refuses to overwrite existing files (use --rotate NAME to replace one deliberately). Prints names only, never values.
import { randomBytes, generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import { ROLES } from "./db-bootstrap.mjs";

const args = process.argv.slice(2);
const dir = path.resolve(args.includes("--dir") ? args[args.indexOf("--dir") + 1] : process.env.AZEE_SECRETS_DIR || "secrets-staging");
const rotate = args.includes("--rotate") ? args[args.indexOf("--rotate") + 1] : null;
const hex = (n = 24) => randomBytes(n).toString("hex");
const enc = encodeURIComponent;
const DBHOST = process.env.AZEE_DB_HOSTPORT || "db:5432";   // native staging: 127.0.0.1:54400

export function build() {
  const pw = Object.fromEntries(ROLES.map((r) => [r, hex()]));
  const url = (role, db) => `postgres://${role}:${enc(pw[role])}@${DBHOST}/${db}`;
  const rsa = generateKeyPairSync("rsa", { modulusLength: 3072 });
  return {
    postgres_admin_password: hex(),
    ...Object.fromEntries(ROLES.map((r) => [`db_${r}_password`, pw[r]])),
    AZTRADE_SERVICE_SECRET: hex(32),
    AZTRADE_JWT_PRIVATE_KEY: rsa.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    // URLs by service. The identity/introspection listener reads A-Zee's database (its variable keeps the AZTRADE_ prefix used by deploy-config).
    AZEE_DATABASE_URL: url("azee_app", "azee_staging"), AZEE_MIGRATION_DATABASE_URL: url("azee_owner", "azee_staging"),
    AZTRADE_DATABASE_URL: url("azee_app", "azee_staging"),
    AZTRADE_API_DATABASE_URL: url("aztrade_app", "aztrade_staging"), AZTRADE_MIGRATION_DATABASE_URL: url("aztrade_owner", "aztrade_staging"),
    AZTRADE_PROVISIONER_DATABASE_URL: url("aztrade_provisioner", "aztrade_staging"), AZTRADE_MARKETDATA_DATABASE_URL: url("aztrade_marketdata", "aztrade_staging"),
  };
}
if (process.argv[1]?.endsWith("make-secrets.mjs")) {
  mkdirSync(dir, { recursive: true });
  const all = build(); const written = [], kept = [];
  for (const [name, value] of Object.entries(all)) {
    const f = path.join(dir, name);
    if (rotate ? name !== rotate : existsSync(f)) { kept.push(name); continue; }
    if (rotate && !existsSync(f)) throw new Error(`no such secret ${name}`);
    writeFileSync(`${f}.tmp`, value, { mode: 0o600 }); renameSync(`${f}.tmp`, f); written.push(name);
  }
  // NOTE: generated URLs embed role passwords generated in THIS run. If only some files already existed, regenerate everything
  // (delete the directory) so URLs and db_*_password files stay consistent; --rotate is for independent secrets only.
  if (kept.length && written.length && !rotate) console.error("WARNING: partial set; delete the directory and re-run to keep passwords and URLs consistent");
  console.log(JSON.stringify({ dir, written, kept }, null, 2));
}
