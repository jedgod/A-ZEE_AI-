// Launcher for the private mTLS /introspect listener.
//   node --experimental-transform-types scripts/introspect-listener.mjs
// Configuration (names only; see docs/azee-staging-deployment-spec.md): AZEE_SECRET_PROVIDER=file, AZEE_SECRETS_DIR, the
// AZTRADE_MTLS_* file paths and listen host, AZEE_ENV. Refuses to start if anything security-relevant is missing.
import { register } from "node:module";
register("./ts-alias-hooks.mjs", import.meta.url);
const { startListener } = await import("../lib/aztrade/listener.ts");
try {
  const svc = await startListener();
  const stop = async () => { await svc.close(); process.exit(0); };
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
} catch (e) {
  console.error(String(e instanceof Error ? e.message : e).split("\n").slice(0, 25).join("\n"));   // setting names only, never values
  process.exit(1);
}
