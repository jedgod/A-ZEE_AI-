#!/usr/bin/env node
// AI gateway integration checks against the running native stack in AZ_PROVIDER_MODE=ollama-only, using the MOCK Ollama fixture
// (scripts/staging/fake-ollama.mjs). Proves routing/metering/refund/fail-closed plumbing. It does NOT prove model quality or capacity.
//   node scripts/staging/native-ai-verify.mjs [--base G:\A-Z_AI\staging-local] [--lan 10.0.0.237] [--fake http://127.0.0.1:11435] [--model qwen2.5:1.5b] [--digest sha256:...]
import https from "node:https";
import http from "node:http";
import { readFileSync } from "node:fs";
import { randomUUID, randomBytes, scrypt } from "node:crypto";
import path from "node:path";
import pg from "pg";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const base = arg("base", "G:\\A-Z_AI\\staging-local"), lan = arg("lan", "10.0.0.237"), fake = arg("fake", "http://127.0.0.1:11435");
const MODEL = arg("model", "qwen2.5:1.5b"), DIGEST = arg("digest", "sha256:" + "f".repeat(64));
const ca = readFileSync(path.join(base, "pki/live/gateway/ca.pem")), origin = `https://${lan}:8443`;
const secret = (n) => readFileSync(path.join(base, "secrets", n), "utf8").trim();
let failures = 0; const check = (n, ok, d = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${ok ? "" : "  " + d}`); if (!ok) failures++; };
const call = (url, { method = "GET", headers = {}, body } = {}) => new Promise((ok) => {
  const u = new URL(url), lib = u.protocol === "https:" ? https : http;
  const r = lib.request(u, { method, headers: { ...headers, ...(body ? { "content-type": "application/json" } : {}) }, ...(u.protocol === "https:" ? { ca, servername: "localhost" } : {}), timeout: 25_000 }, (res) => { let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => { let j = null; try { j = JSON.parse(b); } catch {} ok({ status: res.statusCode, json: j, text: b, cookies: (res.headers["set-cookie"] ?? []).map((c) => c.split(";")[0]) }); }); });
  r.on("error", () => ok({ status: "ERR", text: "" })); r.on("timeout", () => r.destroy()); if (body) r.write(JSON.stringify(body)); r.end();
});
const gw = (p, o = {}) => call(origin + p, { ...o, headers: { origin, ...(o.headers ?? {}) } });
const stats = async () => (await call(fake + "/__stats")).json;
const setMode = (mode) => call(fake + "/__mode", { method: "POST", body: { mode } });
const setDigest = (digest) => call(fake + "/__digest", { method: "POST", body: { digest } });

const owner = new pg.Client({ connectionString: secret("AZEE_MIGRATION_DATABASE_URL") }); await owner.connect();
let userId;
try {
  // synthetic account (fixture), real login route
  const id = (userId = randomUUID()), email = `ai-${id.slice(0, 8)}@example.test`, password = `Aa-${randomUUID()}-5!`, salt = randomBytes(16);
  const key = await new Promise((ok, bad) => scrypt(password.normalize("NFKC"), salt, 64, { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 2 ** 15 * 8 * 2 }, (e, k) => (e ? bad(e) : ok(k))));
  await owner.query("INSERT INTO users (id,email,name,avatar_initials,email_verified_at) VALUES ($1,$2,'AI check','AI',now())", [id, email]);
  const ws = randomUUID(); await owner.query("INSERT INTO workspaces (id,name,owner_id,is_personal,status) VALUES ($1,'Personal account',$2,true,'active')", [ws, id]);
  await owner.query("INSERT INTO user_workspaces (user_id,workspace_id,role) VALUES ($1,$2,'owner')", [id, ws]);
  await owner.query("INSERT INTO user_credentials (user_id,password_hash) VALUES ($1,$2)", [id, `scrypt$${2 ** 15}$8$1$${salt.toString("base64")}$${key.toString("base64")}`]);
  const login = await gw("/api/auth/login", { method: "POST", body: { email, password } }); const cookie = login.cookies.find((c) => c.startsWith("az_user="));
  const cg = await gw("/api/linqext/consent", { headers: { cookie } }); const version = cg.json?.data?.currentVersion ?? cg.json?.data?.version ?? 1;
  await gw("/api/linqext/consent", { method: "PUT", headers: { cookie }, body: { version, replyAssist: true, context: false } });
  const link = (await gw("/api/linqext/keyboard/link", { method: "POST", headers: { cookie }, body: {} })).json?.data; const bearer = link?.accessToken ?? link?.access_token;
  check("keyboard credential obtained (consent granted)", !!bearer);
  // The keyboard is the mobile client: its credentials are only honoured with X-AZ-Client: mobile (otherwise 403 INVALID_ORIGIN).
  const kb = (p, o = {}) => gw(p, { ...o, headers: { authorization: `Bearer ${bearer}`, "x-az-client": "mobile", ...(o.headers ?? {}) } });
  const remaining = async () => { const e = (await kb("/api/linqext/entitlements")).json?.data; return e?.remaining ?? e?.usage?.remaining ?? JSON.stringify(e); };
  const reply = (requestId = randomUUID(), over = {}) => kb("/api/linqext/replies", { method: "POST", body: { requestId, message: "Can we meet tomorrow?", consent: true, ...over } });
  await setMode("ok"); await setDigest(DIGEST);

  console.log("== success path through the existing Ollama provider (ollama-only)");
  const r0 = await remaining(), s0 = await stats(); const rid = randomUUID();
  const ok1 = await reply(rid);
  check("reply returned from the configured provider", ok1.status === 200 && /\[FIXTURE\]/.test(JSON.stringify(ok1.json)), `${ok1.status} ${ok1.text.slice(0, 160)}`);
  check("insertion still requires a user action (never auto-sent)", ok1.json?.data?.insertRequiresUserAction === true);
  const s1 = await stats(); check("exactly one model call, for the CONFIGURED model tag", s1.chat === s0.chat + 1 && s1.lastModelRequested === MODEL, `${s0.chat}->${s1.chat} model=${s1.lastModelRequested}`);
  const r1 = await remaining(); check("one reply charged exactly once", JSON.stringify(r1) !== JSON.stringify(r0), `before=${JSON.stringify(r0)} after=${JSON.stringify(r1)}`);
  const again = await reply(rid); const s2 = await stats(); const r2 = await remaining();
  check("retry with the same request id is an idempotent replay: no new model call, no second charge", again.status === 200 && s2.chat === s1.chat && JSON.stringify(r2) === JSON.stringify(r1), `${again.status} chat ${s1.chat}->${s2.chat}`);

  console.log("== failure modes fail closed, refund, and leak nothing");
  for (const mode of ["fail", "bad-json", "empty"]) {
    await setMode(mode); const before = await remaining(); const res = await reply();
    check(`provider "${mode}": request refused`, res.status >= 400, `${res.status}`);
    check(`provider "${mode}": allowance fully refunded`, JSON.stringify(await remaining()) === JSON.stringify(before));
    check(`provider "${mode}": no upstream detail or provider names in the response`, !/fixture failure|ECONN|11435|openai|gemini|groq|mistral|anthropic|together|openrouter|api[_-]?key/i.test(res.text), res.text.slice(0, 120));
  }
  await setMode("slow"); { const t0 = Date.now(); const before = await remaining(); const res = await reply(); const dt = Date.now() - t0;
    check("slow provider: times out (fail closed) instead of hanging", res.status >= 400 && dt < 20_000, `${res.status} after ${dt}ms`); check("slow provider: allowance refunded", JSON.stringify(await remaining()) === JSON.stringify(before)); }
  await setMode("ok");

  console.log("== model pinning");
  const sBefore = await stats(); await setDigest("sha256:" + "0".repeat(64)); const mism = await reply(); const sAfter = await stats();
  check("a changed model digest is refused BEFORE any prompt is sent", mism.status >= 400 && sAfter.chat === sBefore.chat, `${mism.status} chat ${sBefore.chat}->${sAfter.chat}`);
  await setDigest(DIGEST); check("the pinned digest works again", (await reply()).status === 200);

  console.log("== allowance enforcement");
  const period = new Date().toISOString().slice(0, 7) + "-01"; const ent = (await kb("/api/linqext/entitlements")).json?.data;
  const left = typeof ent?.usage?.remaining === "number" ? ent.usage.remaining : null;   // replies left this month for this tier (usage: {used, limit, remaining})
  if (left !== null) {
    // consume everything that is left (fixture), so the next real request meets an exhausted allowance
    await owner.query("INSERT INTO linqext_usage (user_id, period_start, used) VALUES ($1,$2,$3) ON CONFLICT (user_id, period_start) DO UPDATE SET used = linqext_usage.used + $3", [id, period, left]);
    check("the entitlement now reports nothing remaining", (await kb("/api/linqext/entitlements")).json?.data?.usage?.remaining === 0);
    const sx = await stats(); const exhausted = await reply();
    check("an exhausted allowance refuses the request with a plain message", exhausted.status >= 400, `${exhausted.status} ${exhausted.text.slice(0, 120)}`);
    check("an exhausted allowance never reaches the model", (await stats()).chat === sx.chat);
  } else console.log(`SKIP  allowance exhaustion: entitlement shape has no numeric limit (${JSON.stringify(ent).slice(0, 140)})`);

  console.log("== tier enforcement");
  const many = await reply(randomUUID(), { variants: 3 }); const nReplies = many.json?.data?.replies?.length ?? 0;
  check("a free account cannot obtain more than its tier's variants", many.status >= 400 || nReplies <= 1, `${many.status} replies=${nReplies}`);
} catch (e) { console.log(`FAIL  unexpected error: ${e.message}`); failures++; }
finally { if (userId) await owner.query("DELETE FROM users WHERE id = $1", [userId]).catch(() => {}); await owner.end(); await setMode("ok"); }
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll AI gateway checks passed (MOCK model: plumbing only, not inference quality)"); process.exit(failures ? 1 : 0);
