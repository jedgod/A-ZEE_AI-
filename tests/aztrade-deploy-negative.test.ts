import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { copyFileSync, readFileSync } from "node:fs";
import https from "node:https";
import http from "node:http";
import { generateKeyPairSync } from "node:crypto";
import { createMtlsIntrospectServer } from "@/lib/aztrade/mtls";
import { auditedSecrets, createSecretProvider, fileProvider, SecretError } from "@/lib/secrets";
import { createPki } from "./helpers/pki";

// Deployment-focused NEGATIVE tests. Everything uses a disposable PKI; nothing here proves staging or production isolation.
const { mtlsFetcher } = await import("@/lib/aztrade/mtls-client.js") as any;
const SECRET = "d".repeat(40);
const pki = createPki();
const logs: string[] = [];
type Svc = Awaited<ReturnType<typeof createMtlsIntrospectServer>>;
const start = (over: Record<string, unknown> = {}) => createMtlsIntrospectServer({
  keyFile: pki.f("server.key"), certFile: pki.f("server.pem"), clientCaFile: pki.f("clientca.pem"), crlFile: pki.f("clientca.crl"),
  allowedClientCommonNames: ["aztrade-api", "late-revoked", "mid-rotation"], serviceSecret: SECRET, reloadMs: 3_600_000, maxStaleMs: 600_000,
  introspect: async (t: string) => ({ active: true, n: t.length }), log: (e: any) => logs.push(JSON.stringify(e)), ...over,
} as any);
const call = (url: string, client: string, token: any = "t".repeat(30), secret = SECRET) => mtlsFetcher(pki.clientEnv(client, "serverca"))(url, { method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" }, body: JSON.stringify({ token }) });
const listen = async (s: Svc) => `https://127.0.0.1:${await s.listen(0, "127.0.0.1")}/introspect`;

beforeAll(() => {
  pki.ca("serverca"); pki.ca("clientca"); pki.ca("rogueca");
  pki.leaf("serverca", "server", "server", { server: true });
  for (const c of ["aztrade-api", "late-revoked", "mid-rotation", "other-service"]) pki.leaf("clientca", c);
  pki.leaf("clientca", "expired-client", "aztrade-api", { expired: true });
  pki.leaf("rogueca", "rogue-same-cn", "aztrade-api");                 // allowlisted NAME, wrong issuer
  pki.leaf("serverca", "expired-server", "server", { server: true, expired: true });
  pki.crl("clientca");
});
afterAll(() => pki.cleanup());

describe("public access to /introspect", () => {
  it("the production Next route is not routable unless explicitly placed behind a private network", async () => {
    vi.resetModules(); vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("AZTRADE_INTROSPECT_ROUTE", "");
    vi.doMock("@/lib/users/auth", () => ({ allow: async () => true }));
    vi.doMock("@/lib/admin/db", () => ({ pool: { query: async () => { throw new Error("must not be reached"); } } }));
    const { POST } = await import("@/app/api/aztrade/introspect/route");
    const r = await POST(new Request("https://public.example/api/aztrade/introspect", { method: "POST", headers: { authorization: `Bearer ${SECRET}` }, body: JSON.stringify({ token: "x" }) }));
    expect(r.status).toBe(404);
    vi.unstubAllEnvs(); vi.doUnmock("@/lib/users/auth"); vi.doUnmock("@/lib/admin/db");
  });
  it("the mTLS listener does not speak plain HTTP and refuses a TLS client without a certificate", async () => {
    const s = await start(); const url = await listen(s); const port = Number(new URL(url).port);
    try {
      const plain = await new Promise<string>((ok) => { const q = http.request({ host: "127.0.0.1", port, method: "POST", path: "/introspect" }, (res) => ok(`status ${res.statusCode}`)); q.on("error", () => ok("refused")); q.end("{}"); });
      expect(plain).toBe("refused");
      await expect(new Promise((ok, bad) => { const q = https.request(url, { method: "POST", ca: readFileSync(pki.f("serverca.pem")) }, (res) => ok(res.statusCode)); q.on("error", bad); q.end("{}"); })).rejects.toBeDefined();
    } finally { await s.close(); }
  });
});

describe("certificates", () => {
  it("refuses to start with a missing or expired server certificate or a missing allowlist", async () => {
    await expect(start({ certFile: pki.f("nope.pem") })).rejects.toThrow();
    await expect(start({ certFile: pki.f("expired-server.pem"), keyFile: pki.f("expired-server.key") })).rejects.toThrow(/expired/);
    await expect(start({ allowedClientCommonNames: [], allowedClientFingerprints: [] })).rejects.toThrow(/allowlist/);
    await expect(start({ serviceSecret: "short" })).rejects.toThrow(/32/);
  });
  it("refuses an expired client certificate even though its name is allowlisted", async () => {
    const s = await start(); const url = await listen(s);
    try { await expect(call(url, "expired-client")).rejects.toThrow(); expect((await call(url, "aztrade-api")).status).toBe(200); } finally { await s.close(); }
  });
  it("refuses an unauthorized service identity, and an allowlisted name presented by the wrong CA", async () => {
    const s = await start(); const url = await listen(s);
    try {
      expect((await call(url, "other-service")).status).toBe(403);
      await expect(call(url, "rogue-same-cn")).rejects.toThrow();
    } finally { await s.close(); }
  });
});

describe("revocation and rotation", () => {
  it("revoking a certificate drops its already-open keep-alive connection", async () => {
    const s = await start(); const url = await listen(s);
    try {
      expect((await call(url, "late-revoked")).status).toBe(200);          // connection now open and reused by the shared keep-alive agent
      expect((await call(url, "late-revoked")).status).toBe(200);
      pki.revoke("clientca", "late-revoked"); await s.reload();
      const after = await call(url, "late-revoked").then((r: any) => r.status, () => "refused");
      expect([401, "refused"]).toContain(after);                              // never 200 on the old connection
      expect((await call(url, "aztrade-api")).status).toBe(200);
    } finally { await s.close(); }
  });
  it("rotating the server certificate while requests are in flight loses none of them", async () => {
    const s = await start(); const url = await listen(s);
    try {
      expect((await call(url, "mid-rotation")).status).toBe(200);
      pki.leaf("serverca", "server2", "server", { server: true });
      const burst = Promise.all(Array.from({ length: 40 }, async (_, i) => { await new Promise((r) => setTimeout(r, i % 5)); return call(url, "mid-rotation", "t".repeat(20 + i)).then((r: any) => r.json()); }));
      copyFileSync(pki.f("server2.pem"), pki.f("server.pem")); copyFileSync(pki.f("server2.key"), pki.f("server.key")); await s.reload();
      const results = await burst;
      results.forEach((r: any, i: number) => expect(r).toEqual({ active: true, n: 20 + i }));    // correct answer for each request, none lost or crossed
      expect((await call(url, "aztrade-api")).status).toBe(200);                                 // new connections use the rotated certificate
    } finally { await s.close(); }
  });
});

describe("dependency outages fail closed", () => {
  it("secret-provider outage: no value is invented, stale values are not served past their lifetime, provider text never leaks", async () => {
    let t = 0; let up = true;
    const s = auditedSecrets({ kind: "x", get: async () => { if (!up) throw new Error("connect ECONNREFUSED vault password=hunter2"); return "v"; } }, () => {}, 1000, () => t);
    expect(await s.require("K")).toBe("v"); up = false;
    expect(await s.require("K")).toBe("v");                                   // inside the cache window
    t = 5000; await expect(s.require("K")).rejects.toThrow("secret store unavailable");   // outside it: fail closed
    await expect(s.require("K")).rejects.not.toThrow(/hunter2/);
    expect(() => createSecretProvider({ NODE_ENV: "production" })).toThrow(SecretError);
    await expect(fileProvider("Z:\\definitely\\missing").get("K")).resolves.toBeNull();
  });
  it("introspection backend outage answers 503 and an unreachable service is a refusal for the caller", async () => {
    let healthy = true;
    const s = await start({ introspect: async () => { if (!healthy) throw new Error("database connection terminated"); return { active: true }; } }); const url = await listen(s);
    expect((await call(url, "aztrade-api")).status).toBe(200); healthy = false;
    const down = await call(url, "aztrade-api"); expect(down.status).toBe(503); expect(JSON.stringify(await down.json())).not.toMatch(/database/);
    await s.close();
    await expect(call(url, "aztrade-api")).rejects.toThrow();                // service gone: transport error, never an "active" answer
  });
  it("the real route turns a database outage into a 503 refusal", async () => {
    vi.resetModules();
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("AZEE_JWT_ISSUER", "https://issuer.invalid"); vi.stubEnv("AZTRADE_SERVICE_SECRET", SECRET);
    vi.stubEnv("AZTRADE_JWT_KID", "k1"); vi.stubEnv("AZTRADE_JWT_PRIVATE_KEY", privateKey.export({ type: "pkcs8", format: "pem" }).toString());
    vi.doMock("@/lib/users/auth", () => ({ allow: async () => true, sha: (x: string) => x, tokenFrom: () => null }));
    vi.doMock("@/lib/admin/db", () => ({ pool: { query: async () => { throw new Error("db down"); } } }));
    const identity = await import("@/lib/aztrade/identity"); const { POST } = await import("@/app/api/aztrade/introspect/route");
    const ring = identity.aztradeConfig().ring; const { signJwt } = await import("@/lib/aztrade/jwt"); const now = Math.floor(Date.now() / 1000);
    const token = signJwt(ring, { iss: "https://issuer.invalid", aud: "aztrade-api", sub: "u", sid: "a".repeat(64), jti: "j", iat: now, exp: now + 300 });
    const r = await POST(new Request("http://localhost/api/aztrade/introspect", { method: "POST", headers: { authorization: `Bearer ${SECRET}` }, body: JSON.stringify({ token }) }));
    expect(r.status).toBe(503); expect((await r.json()).active).toBe(false);
    vi.unstubAllEnvs(); vi.doUnmock("@/lib/users/auth"); vi.doUnmock("@/lib/admin/db");
  });
  it("logs never contain the service credential or any token", () => { const all = logs.join("\n"); expect(all).not.toContain(SECRET); expect(all).not.toContain("tttttt"); });
});
