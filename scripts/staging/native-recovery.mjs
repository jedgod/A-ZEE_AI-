#!/usr/bin/env node
// Helper for outage / rotation tests on the native stack.
//   node scripts/staging/native-recovery.mjs make-token            -> {"token":..,"userId":..}   (synthetic verified account, signed in through the gateway)
//   node scripts/staging/native-recovery.mjs poll <token> <seconds> [intervalMs]  -> prints a status histogram + first/last statuses of GET /api/paper
//   node scripts/staging/native-recovery.mjs cleanup <userId>
import https from "node:https";
import http from "node:http";
import { readFileSync } from "node:fs";
import { randomUUID, randomBytes, scrypt } from "node:crypto";
import path from "node:path";
import pg from "pg";

const base = process.env.STAGING_BASE || "G:\\A-Z_AI\\staging-local", lan = process.env.STAGING_LAN || "10.0.0.237", port = 8443;
const secret = (n) => readFileSync(path.join(base, "secrets", n), "utf8").trim();
const ca = readFileSync(path.join(base, "pki/live/gateway/ca.pem")); const origin = `https://${lan}:${port}`;
const req = (url, { method = "GET", headers = {}, body } = {}) => new Promise((ok) => {
  const u = new URL(url); const lib = u.protocol === "https:" ? https : http;
  const r = lib.request(u, { method, headers: { ...headers, ...(body ? { "content-type": "application/json" } : {}) }, ...(u.protocol === "https:" ? { ca, servername: "localhost" } : {}), timeout: 8000 }, (res) => { let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => ok({ status: res.statusCode, text: b, cookies: (res.headers["set-cookie"] ?? []).map((c) => c.split(";")[0]) })); });
  r.on("error", () => ok({ status: "ERR", text: "" })); r.on("timeout", () => { r.destroy(); }); if (body) r.write(JSON.stringify(body)); r.end();
});
const [cmd, a, b, c] = process.argv.slice(2);
const db = () => new pg.Client({ connectionString: secret("AZEE_MIGRATION_DATABASE_URL") });

if (cmd === "make-token") {
  const o = db(); await o.connect(); const id = randomUUID(), email = `recovery-${id.slice(0, 8)}@example.test`, password = `Rr-${randomUUID()}-7!`, salt = randomBytes(16);
  const key = await new Promise((ok, bad) => scrypt(password.normalize("NFKC"), salt, 64, { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 2 ** 15 * 8 * 2 }, (e, k) => (e ? bad(e) : ok(k))));
  await o.query("INSERT INTO users (id,email,name,avatar_initials,email_verified_at) VALUES ($1,$2,'Recovery','RC',now())", [id, email]);
  const ws = randomUUID(); await o.query("INSERT INTO workspaces (id,name,owner_id,is_personal,status) VALUES ($1,'Personal account',$2,true,'active')", [ws, id]);
  await o.query("INSERT INTO user_workspaces (user_id,workspace_id,role) VALUES ($1,$2,'owner')", [id, ws]);
  await o.query("INSERT INTO user_credentials (user_id,password_hash) VALUES ($1,$2)", [id, `scrypt$${2 ** 15}$8$1$${salt.toString("base64")}$${key.toString("base64")}`]); await o.end();
  const login = await req(origin + "/api/auth/login", { method: "POST", headers: { origin }, body: { email, password } });
  const cookie = login.cookies.find((x) => x.startsWith("az_user="));
  const t = JSON.parse((await req(origin + "/api/aztrade/token", { method: "POST", headers: { origin, cookie } })).text);
  console.log(JSON.stringify({ token: t.access_token, userId: id }));
} else if (cmd === "poll") {
  const end = Date.now() + Number(b) * 1000, every = Number(c || 500), hist = {}, seq = [];
  while (Date.now() < end) { const r = await req("http://127.0.0.1:3001/api/paper", { headers: { authorization: `Bearer ${a}` } }); hist[r.status] = (hist[r.status] ?? 0) + 1; seq.push(r.status); await new Promise((r2) => setTimeout(r2, every)); }
  console.log(JSON.stringify({ histogram: hist, first: seq[0], last: seq.at(-1), sequence: seq.length > 60 ? "(long)" : seq.join(",") }));
} else if (cmd === "cleanup") { const o = db(); await o.connect(); await o.query("DELETE FROM users WHERE id = $1", [a]); await o.end(); }
else { console.error("usage: make-token | poll <token> <seconds> [ms] | cleanup <userId>"); process.exit(2); }
