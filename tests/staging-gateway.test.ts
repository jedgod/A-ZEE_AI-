import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import https from "node:https";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pki } from "../scripts/staging/pki.mjs";
import { createGateway, decide } from "../scripts/staging/gateway.mjs";

// The native gateway must implement the same default-deny allowlist as deploy/azee-staging-local/gateway/nginx.conf.
const nginx = readFileSync(path.join(__dirname, "../deploy/azee-staging-local/gateway/nginx.conf"), "utf8");
describe("allowlist decisions", () => {
  it.each(["/", "/_next/static/x.js", "/login", "/register", "/account/settings", "/pricing", "/api/auth/login", "/api/auth/logout-all", "/api/me/access", "/api/subscriptions", "/api/plans", "/api/chat", "/api/chats/1", "/api/linqext/replies", "/api/linqext/keyboard/link", "/api/aztrade/token"])("allows %s", (p) => expect(decide(p)).toBe(200));
  it.each(["/api/aztrade/introspect", "/api/aztrade/jwks", "/api/aztrade/ai", "/api/aztrade/token/x", "/api/admin/users", "/api/operations/dashboard", "/api/staff/session", "/api/webhooks/stripe", "/api/v1/chat", "/api/connectors/github", "/api/payments", "/.env", "/health", "/api", "/admin", "/operations", "/loginx", "/api/authx", "//api/admin/users"])("denies %s", (p) => expect(decide(p)).toBe(404));
  it("every approved route family in nginx.conf is also allowed here", () => {
    for (const fam of ["login", "signin", "register", "verify-email", "forgot-password", "reset-password", "account", "pricing"]) { expect(nginx).toContain(fam); expect(decide(`/${fam}`)).toBe(200); }
    for (const fam of ["auth", "account", "me", "subscriptions", "plans", "chat", "chats", "linqext"]) { expect(nginx).toContain(fam); expect(decide(`/api/${fam}/x`)).toBe(200); }
  });
});
describe("gateway process", () => {
  let dir: string, gw: ReturnType<typeof createGateway>, upstream: http.Server, port: number, ca: Buffer; const seen: string[] = [];
  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "gw-")); const p = pki(path.join(dir, "pki")); p.init(); p.rotate(); ca = readFileSync(path.join(dir, "pki/live/gateway/ca.pem"));
    upstream = http.createServer((req, res) => { seen.push(req.url!); res.end("app:" + req.url); }); await new Promise<void>((ok) => upstream.listen(0, "127.0.0.1", ok));
    gw = createGateway({ tlsDir: path.join(dir, "pki/live/gateway"), appUrl: `http://127.0.0.1:${(upstream.address() as any).port}`, log: () => {} });
    await new Promise<void>((ok) => gw.listen(0, "127.0.0.1", ok)); port = (gw.address() as any).port;
  });
  afterAll(async () => { gw.close(); upstream.close(); gw.closeAllConnections(); rmSync(dir, { recursive: true, force: true }); });
  const get = (p: string) => new Promise<{ s: number; b: string }>((ok, bad) => { https.get({ host: "127.0.0.1", port, path: p, ca, servername: "localhost" }, (r) => { let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => ok({ s: r.statusCode!, b })); }).on("error", bad); });
  it("proxies approved routes over verified TLS and never lets denied routes reach the app", async () => {
    expect(await get("/login")).toEqual({ s: 200, b: "app:/login" });
    for (const p of ["/api/aztrade/introspect", "/api/admin/users", "/api/webhooks/stripe", "/secret"]) expect((await get(p)).s).toBe(404);
    expect(seen).toEqual(["/login"]);
  });
  it("does not serve plain HTTP", async () => { await expect(new Promise((ok, bad) => { http.get({ host: "127.0.0.1", port, path: "/login", timeout: 2000 }, (r) => ok(r.statusCode)).on("error", bad); })).rejects.toBeDefined(); });
});
