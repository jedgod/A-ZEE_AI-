import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import http from "node:http";
import path from "node:path";
import { randomUUID, generateKeyPairSync } from "node:crypto";
import { pathToFileURL } from "node:url";

// CROSS-APPLICATION certification: A-Zee's REAL route handlers and REAL PostgreSQL on one side, AZTrade's REAL auth,
// provisioning, request-scoped database and assistant/paper routers (and its own disposable PostgreSQL 16) on the other.
// Only the AI model call is replaced. Skipped unless the runner provides the disposable databases:
//   AZTRADE_XAPP=YES  DATABASE_URL=<A-Zee disposable DB>  AZTRADE_CERT_CONFIG=<AZTrade cert-config.json>  AZTRADE_CERT_DISPOSABLE=YES  AZTRADE_BACKEND=<AZTrade backend dir>
const RUN = process.env.AZTRADE_XAPP === "YES" && process.env.AZTRADE_CERT_DISPOSABLE === "YES" && !!process.env.DATABASE_URL && !!process.env.AZTRADE_BACKEND;
const chat = vi.hoisted(() => ({ answerChat: vi.fn(), prompts: [] as string[], mode: "ok" as "ok" | "fail" | "hallucinate" }));
vi.mock("@/lib/pipeline", () => ({ answerChat: chat.answerChat }));

const pem = () => generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const SECRET = "x".repeat(48);
const SAFE = "I can only state figures that come from your own AZTrade account data";
const d = RUN ? describe : describe.skip;

d("AZTrade <-> A-Zee on real PostgreSQL 16", () => {
  let azee: http.Server, azeeBase = "", trade: http.Server, tradeBase = "";
  let pool: any, createSession: any, cert: any;
  let k1 = pem();
  const BACKEND = process.env.AZTRADE_BACKEND!;
  const load = (rel: string) => import(/* @vite-ignore */ pathToFileURL(path.join(BACKEND, rel)).href);

  const setKeys = (current: ReturnType<typeof pem>, kid: string, previous: { kid: string; pem: string }[] = []) => {
    process.env.AZTRADE_JWT_PRIVATE_KEY = current.privateKey; process.env.AZTRADE_JWT_KID = kid;
    process.env.AZTRADE_JWT_PREVIOUS_PUBLIC_KEYS = previous.length ? JSON.stringify(previous) : "";
  };

  beforeAll(async () => {
    Object.assign(process.env, { AZEE_JWT_ISSUER: "http://127.0.0.1", AZEE_JWT_AUDIENCE: "aztrade-api", AZTRADE_SERVICE_SECRET: SECRET, AZEE_APP_ORIGIN: "http://localhost" });
    setKeys(k1, "k1");
    pool = (await import("@/lib/admin/db")).pool;                          // A-Zee's real pool, on A-Zee's DATABASE_URL (created now)
    createSession = (await import("@/lib/users/auth")).createSession;
    const routes = {
      "/api/aztrade/token": await import("@/app/api/aztrade/token/route"), "/api/aztrade/jwks": await import("@/app/api/aztrade/jwks/route"),
      "/api/aztrade/introspect": await import("@/app/api/aztrade/introspect/route"), "/api/aztrade/ai": await import("@/app/api/aztrade/ai/route"),
    } as Record<string, any>;
    azee = http.createServer(async (req, res) => {
      const route = routes[(req.url ?? "").split("?")[0]];
      if (!route) { res.writeHead(404).end(); return; }
      const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
      const response: Response = await route[req.method ?? "GET"](new Request(`http://localhost${req.url}`, { method: req.method, headers, body: req.method === "GET" ? undefined : body }));
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
    });
    await new Promise<void>(r => azee.listen(0, "127.0.0.1", r)); azeeBase = `http://127.0.0.1:${azee.address() && (azee.address() as any).port}`;

    // AZTrade, on ITS database and restricted roles (the environment it will have in production).
    const cfg = JSON.parse((await import("node:fs")).readFileSync(process.env.AZTRADE_CERT_CONFIG!, "utf8"));
    Object.assign(process.env, {
      DATABASE_URL: cfg.appUrl, PROVISIONER_DATABASE_URL: cfg.provisionerUrl, AUTH_MODE: "jwt", NODE_ENV: "test",
      AZEE_JWKS_URL: `${azeeBase}/api/aztrade/jwks`, AZEE_INTROSPECTION_URL: `${azeeBase}/api/aztrade/introspect`, AZEE_INTROSPECTION_TOKEN: SECRET,
      AZEE_JWKS_COOLDOWN_MS: "50", AZEE_AI_BRIDGE_URL: `${azeeBase}/api/aztrade/ai`, AZEE_AI_BRIDGE_TOKEN: SECRET, AZTRADE_PAPER_EXECUTION_CERTIFIED: "true",
    });
    cert = await load("tests/helpers/cert.js");
    const express = (await import(/* @vite-ignore */ pathToFileURL(path.join(BACKEND, "node_modules/express/index.js")).href)).default;
    const { authMiddleware } = await load("lib/auth.js"); const { requestDb } = await load("lib/request-db.js");
    const assistant = (await load("routes/assistant.js")).default, paper = (await load("routes/paper.js")).default;
    const app = express(); app.use(express.json());
    app.use("/api/assistant", authMiddleware, requestDb, assistant); app.use("/api/paper", authMiddleware, requestDb, paper);
    await new Promise<void>(r => { trade = app.listen(0, "127.0.0.1", r); }); tradeBase = `http://127.0.0.1:${(trade.address() as any).port}`;
    await cert.createInstrument("XAPP1", "10");
    chat.answerChat.mockImplementation(async (input: any) => {
      chat.prompts.push(input.messages[0].content);
      if (chat.mode === "fail") throw new Error("provider down");
      return { answer: chat.mode === "hallucinate" ? "XAPP1 is trading at $228.45 today." : "Your paper cash is $100,000.00.", meta: {} };
    });
  }, 120_000);
  afterAll(async () => {
    if (trade) await new Promise(r => trade.close(r)); if (azee) await new Promise(r => azee.close(r));
    await (await load("lib/provision.js")).closeProvisioner?.(); await (await load("lib/db.js")).default.end().catch(() => {}); await cert?.closePools?.();
  });

  // ---- helpers ----
  const newUser = async (plan?: string, verified = true) => {
    const id = `xu-${randomUUID()}`;
    await pool.query("INSERT INTO users (id, email, name, email_verified_at) VALUES ($1,$2,'Xapp Test',$3)", [id, `${id}@example.test`, verified ? new Date() : null]);
    if (plan) await subscribe(id, plan);
    return { id, session: await createSession(id) as string };
  };
  const subscribe = (userId: string, plan: string, status = "active", periodEnd: string | null = null) =>
    pool.query(`INSERT INTO subscriptions (id, user_id, plan_id, status, current_period_end) VALUES ($1,$2,$3,$4,$5)`, [randomUUID(), userId, plan, status, periodEnd]);
  const setPlanStatus = (userId: string, status: string, periodEnd: string | null = null) => pool.query("UPDATE subscriptions SET status=$2, current_period_end=$3, updated_at=now() WHERE user_id=$1", [userId, status, periodEnd]);
  const mint = (session: string) => fetch(`${azeeBase}/api/aztrade/token`, { method: "POST", headers: { authorization: `Bearer ${session}`, "x-az-client": "mobile" } }).then(async r => ({ status: r.status, body: await r.json() as any }));
  const tokenFor = async (session: string) => { const r = await mint(session); expect(r.status).toBe(200); return r.body.access_token as string; };
  const api = (token: string | null, method: string, p: string, body?: unknown) => fetch(tradeBase + p, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) as any }));
  const history = (t: string) => api(t, "GET", "/api/assistant/history");
  const ask = (t: string, over: object = {}) => api(t, "POST", "/api/assistant/chat", { message: "How is my account?", ...over });
  const tradeUser = async (sub: string) => { const { rows: [{ id }] } = await cert.pools.owner.query("SELECT aztrade_identity_id($1) AS id", [sub]); return { userId: id, tenant: `azee-user:${sub}` }; };
  const tierOf = async (sub: string) => cert.inContext(cert.pools.app, await tradeUser(sub), async (c: any) => (await c.query("SELECT tier FROM users")).rows[0]?.tier);
  const used = async (userId: string) => (await pool.query("SELECT COALESCE(sum(used),0)::int AS n FROM aztrade_ai_usage WHERE user_id=$1", [userId])).rows[0].n;
  const chatUsed = async (userId: string) => (await pool.query("SELECT count(*)::int AS n FROM usage_counters WHERE subject=$1", [`account:${userId}`])).rows[0].n;
  const limit = (plan: string, n: number | null) => pool.query("UPDATE plan_entitlements SET monthly_limit=$2 WHERE plan_id=$1 AND feature='messages'", [plan, n]);

  // ---- authentication ----
  it("migration 033 is applied on A-Zee's database and the AZTrade tables exist", async () => {
    const r = await pool.query("SELECT to_regclass('aztrade_ai_usage') AS a, to_regclass('aztrade_ai_requests') AS b, (SELECT count(*)::int FROM schema_migrations WHERE name='033_aztrade_ai.sql') AS m");
    expect(r.rows[0]).toEqual({ a: "aztrade_ai_usage", b: "aztrade_ai_requests", m: 1 });
  });
  it("A-Zee issues an RS256 token for a live session; AZTrade verifies it, introspects, provisions under its restricted role, and serves the request", async () => {
    const u = await newUser(); const token = await tokenFor(u.session);
    expect(JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString())).toMatchObject({ alg: "RS256", kid: "k1" });
    expect(JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString())).not.toHaveProperty("tier");
    expect(await history(token)).toMatchObject({ status: 200, body: [] });
    expect(await tierOf(u.id)).toBe("free");
    const jwks = await fetch(`${azeeBase}/api/aztrade/jwks`).then(r => r.json()) as any;
    expect(jwks.keys.map((k: any) => k.kid)).toEqual(["k1"]);
  });
  it("no session, a revoked session or an unverified account cannot obtain a token; garbage and tampered tokens are refused by AZTrade", async () => {
    expect((await fetch(`${azeeBase}/api/aztrade/token`, { method: "POST", headers: { "x-az-client": "mobile" } })).status).toBe(401);
    expect((await mint("c".repeat(64))).status).toBe(401);
    const unverified = await newUser(undefined, false); expect((await mint(unverified.session)).status).toBe(401);
    const u = await newUser(); const token = await tokenFor(u.session); const [h, p, s] = token.split(".");
    const forgedBody = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url").toString()), sub: "someone-else" })).toString("base64url");
    for (const bad of ["garbage-garbage-garbage-garbage", `${h}.${forgedBody}.${s}`, `${h}.${p}.${s.slice(0, -3)}AAA`]) expect((await history(bad)).status).toBe(401);
    expect((await api(null, "GET", "/api/assistant/history")).status).toBe(401);
  });
  it("introspection needs the service credential and is recomputed on every call", async () => {
    const u = await newUser(); const token = await tokenFor(u.session);
    const call = (auth?: string) => fetch(`${azeeBase}/api/aztrade/introspect`, { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify({ token }) }).then(async r => ({ status: r.status, body: await r.json() as any }));
    expect((await call()).status).toBe(401); expect((await call("Bearer nope")).status).toBe(401);
    expect((await call(`Bearer ${SECRET}`)).body).toMatchObject({ active: true, sub: u.id, tenant_id: `azee-user:${u.id}`, plan: "free", tier: "free", subscription_status: "active" });
  });
  it("LOGOUT revokes access on the very next AZTrade request, and no new token can be minted", async () => {
    const u = await newUser(); const token = await tokenFor(u.session);
    expect((await history(token)).status).toBe(200);
    await pool.query("UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1", [u.id]);
    expect((await history(token)).status).toBe(401);
    expect((await ask(token)).status).toBe(401);
    expect((await mint(u.session)).status).toBe(401);
  });
  it("an expired or deleted session, and an account that loses its email verification, are refused immediately", async () => {
    const a = await newUser(); const ta = await tokenFor(a.session); await pool.query("UPDATE user_sessions SET expires_at = now() - interval '1 second' WHERE user_id=$1", [a.id]);
    expect((await history(ta)).status).toBe(401);
    const b = await newUser(); const tb = await tokenFor(b.session); await pool.query("UPDATE users SET email_verified_at = NULL WHERE id=$1", [b.id]);
    expect((await history(tb)).status).toBe(401);
  });

  // ---- subscriptions ----
  it("subscription changes apply on the very next request, with A-Zee's real plan ids", async () => {
    const u = await newUser(); const token = await tokenFor(u.session); const seen: string[] = [];
    seen.push((await history(token)).status === 200 ? await tierOf(u.id) : "refused");                          // free
    await subscribe(u.id, "go"); await history(token); seen.push(await tierOf(u.id));                           // go -> plus
    for (const plan of ["plus", "pro25", "pro60", "pro500", "business", "enterprise"]) { await pool.query("UPDATE subscriptions SET plan_id=$2, updated_at=now() WHERE user_id=$1", [u.id, plan]); await history(token); seen.push(await tierOf(u.id)); }
    await setPlanStatus(u.id, "canceled"); await history(token); seen.push(await tierOf(u.id));                 // lapse -> free at once
    await setPlanStatus(u.id, "active", new Date(Date.now() - 60_000).toISOString()); await history(token); seen.push(await tierOf(u.id));   // period ended -> free
    await setPlanStatus(u.id, "active", new Date(Date.now() + 86_400_000).toISOString()); await history(token); seen.push(await tierOf(u.id));  // renewed
    expect(seen).toEqual(["free", "plus", "plus", "premium", "premium", "premium", "premium", "premium", "free", "free", "premium"]);
  });

  // ---- key rotation ----
  it("key rotation across both applications: new key published with the old one honoured, then the old key retired", async () => {
    const u = await newUser(); const t1 = await tokenFor(u.session);
    const k2 = pem(); setKeys(k2, "k2", [{ kid: "k1", pem: k1.publicKey }]);                                   // overlap: sign with k2, still honour k1
    const t2 = await tokenFor(u.session);
    expect(JSON.parse(Buffer.from(t2.split(".")[0], "base64url").toString()).kid).toBe("k2");
    await new Promise(r => setTimeout(r, 120));                                                                  // AZTrade re-reads the JWKS on an unknown kid
    expect(((await fetch(`${azeeBase}/api/aztrade/jwks`).then(r => r.json())) as any).keys.map((k: any) => k.kid)).toEqual(["k2", "k1"]);
    expect((await history(t2)).status).toBe(200); expect((await history(t1)).status).toBe(200);
    setKeys(k2, "k2");                                                                                           // retire k1
    expect((await history(t1)).status).toBe(401); expect((await history(t2)).status).toBe(200);
    k1 = k2;
  });

  // ---- AI: allowance, idempotency, refunds, grounding ----
  it("CONCURRENT allowance: 12 parallel requests with room for 3 are answered 3 times and refused 9 times; chat allowance untouched", async () => {
    const u = await newUser("plus"); const token = await tokenFor(u.session); await limit("plus", 3); chat.answerChat.mockClear(); chat.mode = "ok";
    const rs = await Promise.all(Array.from({ length: 12 }, () => ask(token)));
    expect(rs.filter(r => r.status === 200).length).toBe(3); expect(rs.filter(r => r.status === 429).length).toBe(9);
    expect(chat.answerChat).toHaveBeenCalledTimes(3);
    expect(await used(u.id)).toBe(3); expect(await chatUsed(u.id)).toBe(0);
    expect((await ask(token)).status).toBe(429);
    await limit("plus", 5000);
  });
  it("REPLAY: 10 parallel retries of one requestId run the model once and charge once; the stored answer is replayed; the conversation is stored once", async () => {
    const u = await newUser("plus"); const token = await tokenFor(u.session); chat.answerChat.mockClear(); chat.mode = "ok";
    const requestId = randomUUID();
    const rs = await Promise.all(Array.from({ length: 10 }, () => ask(token, { requestId })));
    for (const r of rs) expect([200, 409]).toContain(r.status);
    const final = await ask(token, { requestId });
    expect(final).toMatchObject({ status: 200, body: { replay: true, reply: "Your paper cash is $100,000.00." } });
    expect(chat.answerChat).toHaveBeenCalledTimes(1); expect(await used(u.id)).toBe(1);
    expect((await history(token)).body.length).toBe(2);
  });
  it("REFUND: a failed model call is not charged, shows as a failure, and the same request can be retried and charged once", async () => {
    const u = await newUser("plus"); const token = await tokenFor(u.session); const requestId = randomUUID();
    chat.mode = "fail"; expect((await ask(token, { requestId })).status).toBe(503);
    expect(await used(u.id)).toBe(0); expect((await history(token)).body.length).toBe(0);
    chat.mode = "ok"; expect((await ask(token, { requestId })).status).toBe(200);
    expect(await used(u.id)).toBe(1);
  });
  it("an unverified financial figure from the model is never shown to the user", async () => {
    const u = await newUser("plus"); const token = await tokenFor(u.session); chat.mode = "hallucinate";
    const r = await ask(token); chat.mode = "ok";
    expect(r.status).toBe(200); expect(r.body.reply).toContain(SAFE); expect(r.body.reply).not.toContain("228.45");
  });
  it("the bridge refuses a forged tenant or user even with the correct service credential", async () => {
    const u = await newUser("plus"), other = await newUser("plus");
    const post = (b: object, auth = `Bearer ${SECRET}`) => fetch(`${azeeBase}/api/aztrade/ai`, { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify({ requestId: randomUUID(), allowance: "aztrade_assistant", message: "hi", grounding: { paper_cash: null, paper_positions: [], market_prices: null, market_data_status: "unavailable" }, ...b }) }).then(r => r.status);
    expect(await post({ user_id: u.id, tenant_id: `azee-user:${other.id}` })).toBe(403);
    expect(await post({ user_id: "ghost", tenant_id: "azee-user:ghost" })).toBe(403);
    expect(await post({ user_id: u.id, tenant_id: `azee-user:${u.id}` }, "Bearer wrong")).toBe(401);
    expect(await post({ user_id: u.id, tenant_id: `azee-user:${u.id}`, allowance: "chat" })).toBe(400);
  });

  // ---- tenants end to end ----
  it("two users share nothing end to end: orders, positions, conversation and AI grounding stay in their own tenant", async () => {
    const a = await newUser("plus"), b = await newUser("plus"); const ta = await tokenFor(a.session), tb = await tokenFor(b.session);
    await cert.setQuote("XAPP1", "10");
    const buy = await api(ta, "POST", "/api/paper/orders", { symbol: "XAPP1", side: "BUY", shares: "3", idempotencyKey: `x-${randomUUID()}` });
    expect(buy.status).toBe(201);
    chat.prompts.length = 0; chat.mode = "ok";
    expect((await ask(ta, { message: "secret-question-from-A" })).status).toBe(200); expect((await ask(tb, { message: "question from B" })).status).toBe(200);
    expect(chat.prompts[0]).toContain('"symbol":"XAPP1"'); expect(chat.prompts[0]).toContain('"paper_cash":"99970.00000000"');
    expect(chat.prompts[1]).not.toContain("XAPP1"); expect(chat.prompts[1]).not.toContain("secret-question-from-A"); expect(chat.prompts[1]).toContain('"paper_cash":"100000.00000000"');
    expect((await history(tb)).body.some((m: any) => /secret-question-from-A|XAPP1/.test(m.content))).toBe(false);
    expect((await api(tb, "GET", "/api/paper/")).body?.positions ?? []).not.toContainEqual(expect.objectContaining({ symbol: "XAPP1" }));
  });
});
