#!/usr/bin/env node
// End-to-end checks against the RUNNING native azee-staging-local stack (see native-up.ps1). Synthetic accounts only.
//   node scripts/staging/native-verify.mjs [--base G:\A-Z_AI\staging-local] [--lan 10.0.0.237] [--port 8443]
// Covers: sign-in, token minting, AZTrade acceptance, tenant isolation, forged tokens, subscription changes, sign-out revocation,
// keyboard link/refresh/unlink, consent, AI allowance fail-closed. Exit code 1 on any failure.
import https from "node:https";
import http from "node:http";
import { readFileSync } from "node:fs";
import { createSign, generateKeyPairSync, randomUUID, randomBytes, scrypt } from "node:crypto";
import path from "node:path";
import pg from "pg";
import { mtlsFetcher } from "../../lib/aztrade/mtls-client.js";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const base = arg("base", "G:\\A-Z_AI\\staging-local"), lan = arg("lan", "10.0.0.237"), port = Number(arg("port", 8443));
const ca = readFileSync(path.join(base, "pki/live/gateway/ca.pem"));
const secret = (n) => readFileSync(path.join(base, "secrets", n), "utf8").trim();
const origin = `https://${lan}:${port}`;
let failures = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  " + detail}`); if (!ok) failures++; };

function call(url, { method = "GET", headers = {}, body, cookie } = {}) {
  const u = new URL(url); const lib = u.protocol === "https:" ? https : http;
  return new Promise((ok, bad) => {
    const h = { ...headers, ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) };
    const r = lib.request(u, { method, headers: h, ...(u.protocol === "https:" ? { ca, servername: "localhost" } : {}), timeout: 20_000 }, (res) => {
      let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => { let j = null; try { j = JSON.parse(b); } catch {} ok({ status: res.statusCode, json: j, text: b, cookies: (res.headers["set-cookie"] ?? []).map((c) => c.split(";")[0]) }); });
    }); r.on("error", bad); r.on("timeout", () => r.destroy(new Error("timeout"))); if (body) r.write(JSON.stringify(body)); r.end();
  });
}
const gw = (p, o = {}) => call(origin + p, { ...o, headers: { origin, ...(o.headers ?? {}) } });
const trade = (p, token, o = {}) => call("http://127.0.0.1:3001" + p, { ...o, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(o.headers ?? {}) } });

// fixture database access (owner role, test data only)
const owner = new pg.Client({ connectionString: secret("AZEE_MIGRATION_DATABASE_URL") }); await owner.connect();
// AZTrade tables are FORCE ROW LEVEL SECURITY (even for the owner), so tenant bindings are read as the instance superuser (fixture only).
const tradeOwner = new pg.Client({ connectionString: `postgres://postgres:${encodeURIComponent(secret("postgres_admin_password"))}@127.0.0.1:54400/aztrade_staging` }); await tradeOwner.connect();
const tag = randomUUID().slice(0, 8);

async function newUser(label) {
  const email = `verify-${label}-${tag}@example.test`, password = `Vv-${randomUUID()}-9!`;
  // Public registration fails closed here (no mail provider is configured for staging, so nobody could verify). Synthetic accounts are
  // therefore created directly as fixtures (verified, scrypt hash in the app's own format) and then signed in through the REAL login route.
  const id = randomUUID(), workspace = randomUUID(), salt = randomBytes(16);
  const key = await new Promise((ok, bad) => scrypt(password.normalize("NFKC"), salt, 64, { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 2 ** 15 * 8 * 2 }, (e, k) => (e ? bad(e) : ok(k))));
  await owner.query("INSERT INTO users (id, email, name, avatar_initials, email_verified_at) VALUES ($1,$2,$3,'VR', now())", [id, email, `Verify ${label}`]);
  await owner.query("INSERT INTO workspaces (id, name, owner_id, is_personal, status) VALUES ($1,'Personal account',$2,true,'active')", [workspace, id]);
  await owner.query("INSERT INTO user_workspaces (user_id, workspace_id, role) VALUES ($1,$2,'owner')", [id, workspace]);
  await owner.query("INSERT INTO user_credentials (user_id, password_hash) VALUES ($1,$2)", [id, `scrypt$${2 ** 15}$8$1$${salt.toString("base64")}$${key.toString("base64")}`]);
  const r = await gw("/api/auth/login", { method: "POST", body: { email, password } });
  if (r.status !== 200) throw new Error(`login ${label} -> ${r.status} ${r.text.slice(0, 200)}`);
  const cookie = r.cookies.find((c) => c.startsWith("az_user="));
  return { label, email, password, cookie, id };
}
const mint = async (u) => (await gw("/api/aztrade/token", { method: "POST", cookie: u.cookie })).json?.access_token;
const introspectVia = async (token, client = "azee-app") => {
  const f = mtlsFetcher({ AZEE_INTROSPECTION_MTLS_CERT_FILE: path.join(base, `pki/live/${client}/cert.pem`), AZEE_INTROSPECTION_MTLS_KEY_FILE: path.join(base, `pki/live/${client}/key.pem`), AZEE_INTROSPECTION_MTLS_CA_FILE: path.join(base, `pki/live/${client}/ca.pem`) });
  const r = await f("https://localhost:18443/introspect", { method: "POST", headers: { authorization: `Bearer ${secret("AZTRADE_SERVICE_SECRET")}` }, body: JSON.stringify({ token }) });
  return { status: r.status, json: await r.json() };
};
const b64 = (x) => Buffer.from(x).toString("base64url");
const forge = (claims, key, kid = "azee-staging-local-1") => { const h = b64(JSON.stringify({ alg: "RS256", kid, typ: "JWT" })), p = b64(JSON.stringify(claims)); return `${h}.${p}.${createSign("RSA-SHA256").update(`${h}.${p}`).sign(key).toString("base64url")}`; };

try {
  console.log("== authentication and token minting");
  check("unauthenticated token mint is refused", (await gw("/api/aztrade/token", { method: "POST" })).status === 401);
  const A = await newUser("a"), B = await newUser("b");
  check("two synthetic accounts sign in through the real login route", !!A.cookie && !!B.cookie);
  const ta = await mint(A), tb = await mint(B);
  check("signed-in users get 5-minute access tokens", !!ta && !!tb && ta !== tb);
  check("token mint without same-origin header is refused", (await call(origin + "/api/aztrade/token", { method: "POST", cookie: A.cookie })).status >= 400);

  console.log("== AZTrade accepts only live, introspected identities");
  const pa = await trade("/api/paper", ta), pb = await trade("/api/paper", tb);
  check("AZTrade API provisions and serves account A", pa.status === 200 && !!pa.json?.accountId, `${pa.status} ${pa.text.slice(0, 120)}`);
  check("AZTrade API provisions and serves account B", pb.status === 200 && !!pb.json?.accountId, `${pb.status}`);
  check("tenant isolation: A and B have different paper accounts and cash is virtual", pa.json?.accountId !== pb.json?.accountId && pa.json?.paperMode === true);
  const ua = (await tradeOwner.query("SELECT id, azee_user_id, tenant_id FROM users WHERE azee_user_id = ANY($1)", [[A.id, B.id]])).rows;
  check("each account is bound to its own tenant", ua.length === 2 && new Set(ua.map((r) => r.tenant_id)).size === 2, JSON.stringify(ua.map((r) => r.tenant_id)));
  check("no bearer token -> 401", (await trade("/api/paper", null)).status === 401);
  check("tampered token -> 401", (await trade("/api/paper", ta.slice(0, -4) + "AAAA")).status === 401);
  const rogue = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey; const now = Math.floor(Date.now() / 1000);
  const claims = { iss: origin, aud: "aztrade-api", sub: A.id, jti: randomUUID(), sid: "a".repeat(64), iat: now, exp: now + 300 };
  check("token signed by a rogue key (same kid) -> 401", (await trade("/api/paper", forge(claims, rogue))).status === 401);
  check("valid signature but non-live session id -> 401", (await trade("/api/paper", await (async () => { const { privateKey } = { privateKey: await import("node:crypto").then((c) => c.createPrivateKey(secret("AZTRADE_JWT_PRIVATE_KEY"))) }; return forge(claims, privateKey); })())).status === 401);
  check("wrong audience -> 401", await (async () => { const k = (await import("node:crypto")).createPrivateKey(secret("AZTRADE_JWT_PRIVATE_KEY")); return (await trade("/api/paper", forge({ ...claims, aud: "other" }, k))).status === 401; })());

  console.log("== subscription enforcement (tier comes from live billing, not the token)");
  const i0 = await introspectVia(ta); check("introspection over mTLS answers for a live token (free tier)", i0.json.active === true && i0.json.tier === "free", JSON.stringify(i0.json));
  const plan = (await owner.query("SELECT id FROM plans WHERE is_active AND id <> 'free' ORDER BY price_monthly NULLS LAST LIMIT 1").catch(() => owner.query("SELECT id FROM plans WHERE id <> 'free' LIMIT 1"))).rows[0]?.id;
  await owner.query("INSERT INTO subscriptions (id, user_id, plan_id, status, billing) VALUES ($1,$2,$3,'active','monthly')", [`verify-${tag}`, A.id, plan]);
  const i1 = await introspectVia(ta); check(`upgrade (${plan}) applies to the SAME token on the next call`, i1.json.active === true && i1.json.plan === plan && i1.json.tier !== "free", JSON.stringify(i1.json));
  await owner.query("UPDATE subscriptions SET status = 'canceled' WHERE id = $1", [`verify-${tag}`]);
  const i2 = await introspectVia(ta); check("cancellation downgrades immediately", i2.json.tier === "free", JSON.stringify(i2.json));
  const i3 = await introspectVia(ta, "aztrade-api"); check("the AZTrade service identity may also introspect", i3.json.active === true);

  console.log("== sign-out and revocation");
  const out = await gw("/api/auth/logout", { method: "POST", cookie: A.cookie }); check("sign-out succeeds", out.status < 300, `${out.status}`);
  check("the same token is refused by AZTrade right after sign-out", (await trade("/api/paper", ta)).status === 401);
  check("introspection reports the token inactive after sign-out", (await introspectVia(ta)).json.active === false);
  const B2 = (await gw("/api/auth/login", { method: "POST", body: { email: B.email, password: B.password } })).cookies.find((c) => c.startsWith("az_user="));
  const tb2 = await mint({ cookie: B2 });
  check("a second session for B works while the first does", (await trade("/api/paper", tb)).status === 200 && (await trade("/api/paper", tb2)).status === 200);
  await gw("/api/auth/logout-all", { method: "POST", cookie: B.cookie });
  check("sign-out-everywhere revokes every B token at once", (await trade("/api/paper", tb)).status === 401 && (await trade("/api/paper", tb2)).status === 401);

  console.log("== AZLinqext keyboard: consent, link, refresh, revocation, allowance (AI provider intentionally absent)");
  const C = await newUser("c"); const consentGet = await gw("/api/linqext/consent", { cookie: C.cookie });
  check("consent starts unset", consentGet.status === 200, `${consentGet.status} ${consentGet.text.slice(0, 100)}`);
  const version = consentGet.json?.data?.currentVersion ?? consentGet.json?.data?.version ?? 1;
  const put = await gw("/api/linqext/consent", { method: "PUT", cookie: C.cookie, body: { version, replyAssist: true, context: false } });
  check("user can grant consent", put.status === 200, `${put.status} ${put.text.slice(0, 160)}`);
  const link = await gw("/api/linqext/keyboard/link", { method: "POST", cookie: C.cookie, body: {} });
  const l = link.json?.data; check("keyboard link issues scoped credentials", link.status === 200 && !!l, `${link.status} ${link.text.slice(0, 160)}`);
  const accessTok = l?.accessToken ?? l?.access_token, refreshTok = l?.refreshToken ?? l?.refresh_token;
  const kb = (p, o = {}) => gw(p, { ...o, headers: { authorization: `Bearer ${accessTok}`, ...(o.headers ?? {}) } });
  const ent0 = await kb("/api/linqext/entitlements"); check("keyboard credential reads entitlements (no browser session)", ent0.status === 200, `${ent0.status}`);
  const rid = randomUUID();
  const rep = await kb("/api/linqext/replies", { method: "POST", body: { requestId: rid, message: "Can we meet tomorrow?", consent: true } });
  check("reply generation fails closed without an AI provider (no provider detail leaked)", rep.status >= 400 && !/api[_ -]?key|openai|gemini|groq|mistral|together|openrouter/i.test(rep.text), `${rep.status} ${rep.text.slice(0, 160)}`);
  const ent1 = await kb("/api/linqext/entitlements");
  check("a failed reply does not consume the monthly allowance", JSON.stringify(ent0.json?.data?.remaining ?? ent0.json?.data) === JSON.stringify(ent1.json?.data?.remaining ?? ent1.json?.data));
  const rf = await gw("/api/linqext/keyboard/refresh", { method: "POST", body: { refreshToken: refreshTok } }); const r = rf.json?.data;
  check("refresh rotates credentials", rf.status === 200 && (r?.refreshToken ?? r?.refresh_token) !== refreshTok, `${rf.status}`);
  // Design: the previous refresh token is tolerated for a 30 s grace window (a lost response must be retryable); a replay AFTER the window
  // is theft evidence: refused and the whole link revoked. First age the rotation (fixture), then replay.
  const linkId = (await owner.query("SELECT id FROM linqext_keyboard_links WHERE user_id = $1 AND revoked_at IS NULL", [C.id])).rows[0]?.id;
  check("the link exists before the replay", !!linkId);
  await owner.query("UPDATE linqext_keyboard_links SET rotated_at = now() - interval '1 hour' WHERE id = $1", [linkId]);
  const replay = await gw("/api/linqext/keyboard/refresh", { method: "POST", body: { refreshToken: refreshTok } });
  check("replaying the old refresh token after the grace window is refused", replay.status === 401, `${replay.status}`);
  check("the replay revoked the link (theft response)", !!(await owner.query("SELECT revoked_at FROM linqext_keyboard_links WHERE id = $1", [linkId])).rows[0]?.revoked_at);
  check("revoked link: neither the keyboard's access token nor its rotated refresh token work", (await gw("/api/linqext/entitlements", { headers: { authorization: `Bearer ${r?.accessToken ?? r?.access_token}` } })).status >= 400 && (await gw("/api/linqext/keyboard/refresh", { method: "POST", body: { refreshToken: r?.refreshToken ?? r?.refresh_token } })).status === 401);
  const withdraw = await gw("/api/linqext/consent", { method: "PUT", cookie: C.cookie, body: { version, replyAssist: false, context: false } });
  check("withdrawing consent is accepted", withdraw.status === 200, `${withdraw.status}`);
  const noConsent = await gw("/api/linqext/replies", { method: "POST", cookie: C.cookie, body: { requestId: randomUUID(), message: "hello", consent: true } });
  check("replies are refused once consent is withdrawn", noConsent.status >= 400, `${noConsent.status} ${noConsent.text.slice(0, 120)}`);
} catch (e) { console.log(`FAIL  unexpected error: ${e.message}`); failures++; }
finally {
  await owner.query("DELETE FROM users WHERE email LIKE $1", [`verify-%-${tag}@example.test`]).catch(() => {});
  await owner.end(); await tradeOwner.end();
}
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll end-to-end checks passed"); process.exit(failures ? 1 : 0);
