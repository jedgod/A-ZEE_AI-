import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const S = vi.hoisted(() => ({ user: { id: "u1" } as { id: string } | null, active: true, sub: "u1", allow: true, strict: true, upstream: vi.fn() }));
vi.mock("@/lib/users/auth", () => ({
  requireUser: async () => { if (!S.user) { const { UserError } = await import("@/lib/users/types"); throw new UserError(401, "SIGN_IN_REQUIRED"); } return S.user; },
  strictOrigin: () => { if (!S.strict) { throw new Error("origin"); } },
  allow: async () => S.allow,
}));
vi.mock("@/lib/aztrade/identity", () => ({ aztradeConfig: () => ({}), introspect: async () => ({ active: S.active, sub: S.sub }) }));

import { companionGateway } from "@/lib/aztrade/companion-gateway";

const TOKEN = "t".repeat(40);
const ID = "3f2b8c1e-1a2b-4c3d-8e4f-5a6b7c8d9e0f";
const req = (method: string, opts: { token?: string | null; body?: unknown; type?: string } = {}) => new Request("http://x/api/aztrade/companion", {
  method,
  headers: { ...(opts.token === null ? {} : { "x-aztrade-token": `Bearer ${opts.token ?? TOKEN}` }), ...(method === "POST" ? { "content-type": opts.type ?? "application/json" } : {}) },
  body: method === "POST" ? (typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body ?? { requestId: ID, message: "hello" })) : undefined,
});
const upstreamOk = () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });

beforeEach(() => {
  Object.assign(process.env, { AZTRADE_AI_COMPANION_ENABLED: "true", AZTRADE_BACKEND_ORIGIN: "http://127.0.0.1:4010" });
  Object.assign(S, { user: { id: "u1" }, active: true, sub: "u1", allow: true, strict: true });
  S.upstream.mockReset(); S.upstream.mockImplementation(async () => upstreamOk());
  vi.stubGlobal("fetch", S.upstream);
});

describe("AZTrade companion gateway", () => {
  it("is off unless the operator turns it on", async () => {
    process.env.AZTRADE_AI_COMPANION_ENABLED = "false";
    expect((await companionGateway(req("GET"), ["paper"])).status).toBe(503);
    expect(S.upstream).not.toHaveBeenCalled();
  });
  it("only ever reaches the fixed allowlist: orders, markets and strategies are not proxied", async () => {
    for (const parts of [["paper", "orders"], ["markets"], ["strategies", "momentum", "backtest"], ["..", "secrets"]]) {
      expect((await companionGateway(req("GET"), parts)).status).toBe(404);
    }
    expect((await companionGateway(req("POST"), ["paper"])).status).toBe(404);          // a write to a read-only resource
    expect(S.upstream).not.toHaveBeenCalled();
  });
  it("answers 401 with the A-Zee reason when the A-Zee sign-in is missing, and never calls the backend", async () => {
    S.user = null;
    const r = await companionGateway(req("GET"), ["paper"]);
    expect(r.status).toBe(401);
    expect((await r.json()).error).toBe("SIGN_IN_REQUIRED");
    expect(S.upstream).not.toHaveBeenCalled();
  });
  it("needs the AZTrade token, and refuses one that belongs to someone else or to a revoked session", async () => {
    expect((await companionGateway(req("GET", { token: null }), ["paper"])).status).toBe(401);
    S.sub = "someone-else";
    expect((await companionGateway(req("GET"), ["paper"])).status).toBe(401);
    S.sub = "u1"; S.active = false;
    expect((await companionGateway(req("GET"), ["paper"])).status).toBe(401);
    expect(S.upstream).not.toHaveBeenCalled();
  });
  it("forwards a valid read to the configured origin only, with the AZTrade token and no cookies", async () => {
    const r = await companionGateway(req("GET"), ["paper"]);
    expect(r.status).toBe(200);
    const [url, init] = S.upstream.mock.calls[0];
    expect(String(url)).toBe("http://127.0.0.1:4010/api/paper");
    expect(init.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(init.redirect).toBe("error");
    expect(r.headers.get("set-cookie")).toBeNull();
  });
  it("checks the question body strictly before anything leaves A-Zee", async () => {
    for (const body of [{ requestId: ID, message: "hi", userId: "x" }, { requestId: "nope", message: "hi" }, { requestId: ID, message: "   " }, { requestId: ID, message: "x".repeat(4001) }, "not json", "[]"]) {
      expect((await companionGateway(req("POST", { body }), ["assistant", "chat"])).status).toBe(400);
    }
    expect((await companionGateway(req("POST", { type: "text/plain" }), ["assistant", "chat"])).status).toBe(415);
    expect((await companionGateway(req("POST", { body: JSON.stringify({ requestId: ID, message: "é".repeat(5000) }) }), ["assistant", "chat"])).status).toBe(413);
    expect(S.upstream).not.toHaveBeenCalled();
    expect((await companionGateway(req("POST"), ["assistant", "chat"])).status).toBe(200);
  });
  it("rate limits, and refuses an upstream that is not JSON or is far too large", async () => {
    S.allow = false;
    expect((await companionGateway(req("GET"), ["paper"])).status).toBe(429);
    S.allow = true;
    S.upstream.mockImplementationOnce(async () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }));
    expect((await companionGateway(req("GET"), ["paper"])).status).toBe(502);
    S.upstream.mockImplementationOnce(async () => new Response("x".repeat(300_000), { status: 200, headers: { "content-type": "application/json" } }));
    expect((await companionGateway(req("GET"), ["paper"])).status).toBe(502);
  });
  it("refuses a backend origin that is not a bare local or HTTPS origin", async () => {
    for (const origin of ["http://evil.example", "https://user:pw@host.example", "https://host.example/path", "https://host.example/?q=1"]) {
      process.env.AZTRADE_BACKEND_ORIGIN = origin;
      expect((await companionGateway(req("GET"), ["paper"])).status).toBe(503);
    }
    expect(S.upstream).not.toHaveBeenCalled();
  });
});
