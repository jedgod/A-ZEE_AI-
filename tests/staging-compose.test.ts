import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

// Static isolation invariants of the azee-staging-local stack. Uses `docker compose config` (no daemon needed). This proves the
// DECLARED topology; it does not prove runtime isolation (that needs the verify-isolation script against a running stack).
const dir = path.resolve(__dirname, "../deploy/azee-staging-local");
let cfg: any = null;
try { cfg = JSON.parse(execFileSync("docker", ["compose", "-f", path.join(dir, "compose.yaml"), "config", "--format", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env: { ...process.env, COMPOSE_PROFILES: "rotation" } })); } catch { /* docker CLI missing */ }
const svc = (n: string) => cfg.services[n];
const nets = (n: string) => Object.keys(svc(n).networks ?? {});

describe.skipIf(!cfg)("azee-staging-local declared topology", () => {
  it("only the gateway publishes a port, and only on loopback by default", () => {
    const published = Object.entries<any>(cfg.services).filter(([, s]) => s.ports?.length).map(([n, s]) => [n, s.ports.map((p: any) => `${p.host_ip}:${p.published}->${p.target}`)]);
    expect(published).toEqual([["gateway", ["127.0.0.1:8443->8443"]]]);
  });
  it("the gateway is on the edge network only; db, introspect, aztrade-api and one-shots are on the internal private network only", () => {
    expect(nets("gateway")).toEqual(["edge"]);
    for (const n of ["db", "introspect", "aztrade-api", "db-bootstrap", "migrate-azee", "migrate-aztrade"]) expect(nets(n), n).toEqual(["private"]);
    expect(nets("app").sort()).toEqual(["edge", "private"]);
    expect(cfg.networks.private.internal).toBe(true);
    expect(cfg.networks.edge.internal ?? false).toBe(false);
  });
  it("no database credential is passed as a plain environment value; secrets are mounted files", () => {
    for (const [n, s] of Object.entries<any>(cfg.services)) for (const [k, v] of Object.entries<string>(s.environment ?? {})) {
      if (/PASSWORD$|_SECRET$|PRIVATE_KEY$|DATABASE_URL$/.test(k) && k !== "POSTGRES_PASSWORD_FILE") throw new Error(`${n}: ${k} must come from a mounted secret, not the environment`);
      expect(v).not.toMatch(/postgres:\/\/[^$ ]+:[^$ ]+@/);
    }
    expect(Object.keys(cfg.secrets).length).toBeGreaterThan(10);
  });
  it("the introspect listener has no published port, a non-wildcard bind, the file secret provider and mounts only its own certificate directory", () => {
    const s = svc("introspect");
    expect(s.ports).toBeUndefined(); expect(s.environment.AZTRADE_MTLS_LISTEN_HOST).not.toMatch(/^(0\.0\.0\.0|::)$/);
    expect(s.environment.AZEE_SECRET_PROVIDER).toBe("file");
    expect(s.volumes.map((v: any) => String(v.source).split("\\").join("/"))).toEqual([expect.stringMatching(/\/live\/introspect$/)]); expect(s.volumes.every((v: any) => v.read_only)).toBe(true);
  });
  it("no service except pki-rotate can see the CA directory, and the CA key never reaches a service mount", () => {
    for (const [n, s] of Object.entries<any>(cfg.services)) for (const v of s.volumes ?? []) {
      if (n === "pki-rotate") continue;
      expect(String(v.source), `${n} mounts`).not.toMatch(/pki[\/]?$|pki[\/]ca/);
    }
    expect(svc("pki-rotate").network_mode).toBe("none");
  });
  it("each runtime service gets only the secrets it needs", () => {
    const secretsOf = (n: string) => Object.keys(svc(n).secrets ?? {}).length ? svc(n).secrets.map((x: any) => x.source).sort() : [];
    expect(secretsOf("aztrade-api")).toEqual(["AZTRADE_API_DATABASE_URL", "AZTRADE_SERVICE_SECRET"]);
    expect(secretsOf("gateway")).toEqual([]);
    expect(secretsOf("introspect")).not.toContain("AZEE_MIGRATION_DATABASE_URL");
    expect(secretsOf("app")).not.toContain("postgres_admin_password");
  });
});

describe("gateway route allowlist (nginx.conf)", () => {
  const conf = readFileSync(path.join(dir, "gateway/nginx.conf"), "utf8");
  const denyBeforeAllow = (re: RegExp) => expect(conf).toMatch(re);
  it("is default-deny and explicitly blocks the internal routes", () => {
    expect(conf).toMatch(/location \/ \{ return 404; \}/);
    denyBeforeAllow(/\^\/api\/aztrade\/\(introspect\|ai\|jwks\)/);
    denyBeforeAllow(/\^\/api\/\(admin\|operations\|staff\|webhooks/);
  });
  it("never proxies to anything but the app, and never mentions the database, introspect host or AZTrade API", () => {
    const targets = [...conf.matchAll(/proxy_pass ([^;]+);/g)].map((m) => m[1]);
    expect(targets.length).toBeGreaterThan(0); expect(new Set(targets)).toEqual(new Set(["$app"]));
    const active = conf.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");   // directives only, not explanatory comments
    expect(active).not.toMatch(/introspect:|db:5432|aztrade-api/);
  });
});
