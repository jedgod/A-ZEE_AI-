import { beforeEach, describe, expect, it, vi } from "vitest";

// The server-side proxy between A-Zee's signed-in pages and the AZTrade API (mocked upstream; see aztrade-e2e for the real thing).
const S = vi.hoisted(() => ({ signedIn: true, allow: true, minted: 0, mintFails: "" as "" | "jwt" | "config" }));
const Err = vi.hoisted(() => class UserError extends Error { constructor(public status: number, public code: string) { super(code); } });
vi.mock("@/lib/users/auth", () => {
  const E = Err;
  return {
    requireUser: async (_r: Request, write = false) => { if (!S.signedIn) throw new E(401, "SIGN_IN_REQUIRED"); return { id: "user-1", write }; },
    allow: async () => S.allow,
    userFailure: (e: any) => Response.json({ error: e.code ?? "ERROR" }, { status: e.status ?? 500 }),
  };
});
vi.mock("@/lib/users/types", () => ({ UserError: Err }));
vi.mock("@/lib/aztrade/identity", async () => {
  class AztradeUnavailable extends Error {}
  const { JwtError } = await import("@/lib/aztrade/jwt");
  return { AztradeUnavailable, mintToken: async () => { S.minted++; if (S.mintFails === "jwt") throw new JwtError("inactive_session"); if (S.mintFails === "config") throw new AztradeUnavailable("x"); return { access_token: "minted.token.value" }; } };
});
import { forward, ROUTES, tradeBase } from "@/lib/aztrade/proxy";

const calls: { url: string; init: any }[] = [];
const fetchMock = vi.fn(async (url: any, init: any) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify({ ok: true }), { status: 201, headers: { "content-type": "application/json" } }); });
vi.stubGlobal("fetch", fetchMock);
const req = (method: string, body?: unknown) => new Request("http://localhost/api/trade/x", { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
beforeEach(() => { calls.length = 0; fetchMock.mockClear(); Object.assign(S, { signedIn: true, allow: true, minted: 0, mintFails: "" }); process.env.AZTRADE_API_URL = "http://127.0.0.1:3001"; (process.env as any).NODE_ENV = "test"; });

describe("allow-list", () => {
  it("forwards only listed method+path pairs, to fixed upstream paths", async () => {
    const cases: [string, string[], string, unknown?][] = [
      ["GET", ["account"], "/api/paper/"], ["POST", ["orders"], "/api/paper/orders", { symbol: "A", side: "BUY", shares: "1", idempotencyKey: "k" }],
      ["GET", ["markets"], "/api/markets"], ["GET", ["markets", "status"], "/api/markets/status"], ["GET", ["assistant", "history"], "/api/assistant/history"],
      ["POST", ["assistant", "chat"], "/api/assistant/chat", { message: "hi" }], ["POST", ["strategies", "momentum", "backtest"], "/api/strategies/momentum/backtest", {}],
    ];
    for (const [m, path, upstream, body] of cases) { calls.length = 0; expect((await forward(req(m, body), path)).status).toBe(201); expect(calls[0].url).toBe(`http://127.0.0.1:3001${upstream}`); }
    expect(ROUTES.length).toBe(8);
  });
  it("refuses everything else: unknown paths, wrong methods, traversal, other tenants' paths, admin and portfolio routes", async () => {
    for (const [m, path] of [["GET", ["admin"]], ["POST", ["account"]], ["GET", ["orders"]], ["GET", ["account", "..", "portfolio"]], ["GET", ["..", "api", "portfolio"]], ["GET", ["portfolio"]], ["GET", ["risk"]],
      ["POST", ["strategies", "..%2Fadmin", "backtest"]], ["POST", ["strategies", "momentum", "backtest", "x"]], ["DELETE", ["account"]], ["GET", [""]], ["GET", ["markets", "AAPL"]]] as [string, string[]][])
      expect((await forward(req(m, m === "POST" ? {} : undefined), path)).status, `${m} ${path.join("/")}`).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled(); expect(S.minted).toBe(0);
  });
});

describe("authentication and identity", () => {
  it("a signed-out request never reaches the upstream and no token is minted", async () => {
    S.signedIn = false;
    expect((await forward(req("GET"), ["account"])).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled(); expect(S.minted).toBe(0);
  });
  it("the upstream call carries ONLY the minted token; any identity or authorization the caller sends is ignored", async () => {
    const r = new Request("http://localhost/x", { method: "POST", headers: { authorization: "Bearer attacker", "x-user-id": "victim", cookie: "az_session=secret", "content-type": "application/json" }, body: JSON.stringify({ message: "hi", user_id: "victim", tenant_id: "azee-user:victim" }) });
    await forward(r, ["assistant", "chat"]);
    const h = calls[0].init.headers; expect(h.authorization).toBe("Bearer minted.token.value"); expect(Object.keys(h).sort()).toEqual(["accept", "authorization", "content-type"]);
    expect(calls[0].init.redirect).toBe("manual");
  });
  it("writes need the same-origin check (requireUser write=true); reads do not", async () => {
    const seen: boolean[] = []; const mod = await import("@/lib/users/auth"); const spy = vi.spyOn(mod, "requireUser").mockImplementation(async (_r: Request, write = false) => { seen.push(write); return { id: "u", name: "", email: "", verified: true }; });
    await forward(req("GET"), ["account"]); await forward(req("POST", {}), ["orders"]); expect(seen).toEqual([false, true]); spy.mockRestore();
  });
  it("a session that ended between the page and the call is a 401; an unconfigured bridge is a 503; rate limiting is a 429", async () => {
    S.mintFails = "jwt"; expect((await forward(req("GET"), ["account"])).status).toBe(401);
    S.mintFails = "config"; expect((await forward(req("GET"), ["account"])).status).toBe(503);
    S.mintFails = ""; S.allow = false; expect((await forward(req("GET"), ["account"])).status).toBe(429);
  });
});

describe("request and response handling", () => {
  it("validates the body: oversized, non-JSON and non-object bodies are refused before any token is minted", async () => {
    expect((await forward(req("POST", "x".repeat(20_000)), ["orders"])).status).toBe(413);
    expect((await forward(req("POST", "not json"), ["orders"])).status).toBe(400);
    expect((await forward(req("POST", "123"), ["orders"])).status).toBe(400);
    expect(S.minted).toBe(0); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("passes upstream statuses through (403 and 429 stay meaningful) and never caches", async () => {
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ error: "Subscription required" }), { status: 403 }));
    const r = await forward(req("POST", {}), ["strategies", "momentum", "backtest"]);
    expect(r.status).toBe(403); expect(r.headers.get("cache-control")).toBe("no-store"); expect(await r.json()).toEqual({ error: "Subscription required" });
  });
  it("an unreachable or hanging upstream fails closed as 503", async () => {
    fetchMock.mockImplementationOnce(async () => { throw new Error("ECONNREFUSED"); });
    expect((await forward(req("GET"), ["account"])).status).toBe(503);
  });
});

describe("upstream address", () => {
  it("requires https outside local development and refuses a missing setting", () => {
    expect(tradeBase({ AZTRADE_API_URL: "https://trade.internal:8443", NODE_ENV: "production" }).host).toBe("trade.internal:8443");
    expect(() => tradeBase({ AZTRADE_API_URL: "http://trade.internal", NODE_ENV: "production" })).toThrow(/https/);
    expect(() => tradeBase({ AZTRADE_API_URL: "http://127.0.0.1:3001", NODE_ENV: "production" })).toThrow(/https/);
    expect(() => tradeBase({ AZTRADE_API_URL: "http://example.com", NODE_ENV: "test" })).toThrow(/https/);
    expect(() => tradeBase({ NODE_ENV: "test" })).toThrow(/not configured/);
    expect(tradeBase({ AZTRADE_API_URL: "http://127.0.0.1:3001", NODE_ENV: "test" }).hostname).toBe("127.0.0.1");
  });
});
