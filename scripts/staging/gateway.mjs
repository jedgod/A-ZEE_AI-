#!/usr/bin/env node
// NATIVE stand-in for the nginx gateway (deploy/azee-staging-local/gateway/nginx.conf) for hosts without Docker.
// Same contract: HTTPS only, DEFAULT DENY, explicit allowlist of routes, everything else 404. Proxies to the app only.
//   GATEWAY_BIND=10.0.0.237 GATEWAY_PORT=8443 APP_URL=http://127.0.0.1:3000 GATEWAY_TLS_DIR=<pki>/live/gateway node scripts/staging/gateway.mjs
import https from "node:https";
import http from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";

const DENY = [/^\/api\/(admin|operations|staff|webhooks|v1|code-agent|connectors|payments|payment-methods)(\/|$)/, /^\/api\/aztrade\/(introspect|ai|jwks)(\/|$)/];
const ALLOW = [
  /^\/$/, /^\/_next\//,
  /^\/(login|signin|register|verify-email|forgot-password|reset-password|account|pricing)(\/|$)/,
  /^\/api\/(auth|account|me|subscriptions|plans|chat|chats|linqext)(\/|$)/,
  /^\/api\/aztrade\/token$/,
];
export const decide = (pathname) => (DENY.some((r) => r.test(pathname)) ? 404 : ALLOW.some((r) => r.test(pathname)) ? 200 : 404);

export function createGateway({ tlsDir, appUrl, log = (l) => console.log(l) }) {
  const app = new URL(appUrl);
  const buckets = new Map();   // naive per-IP limiter: 40 requests / second
  const limited = (ip) => { const now = Math.floor(Date.now() / 1000); const b = buckets.get(ip); if (!b || b.t !== now) { buckets.set(ip, { t: now, n: 1 }); return false; } return ++b.n > 40; };
  const server = https.createServer({ key: readFileSync(path.join(tlsDir, "key.pem")), cert: readFileSync(path.join(tlsDir, "cert.pem")), minVersion: "TLSv1.2" }, (req, res) => {
    const u = new URL(req.url, "https://gateway.local");
    const ip = req.socket.remoteAddress ?? "";
    const finish = (status, body = "") => { res.writeHead(status, { "content-type": "text/plain", "x-content-type-options": "nosniff", "strict-transport-security": "max-age=31536000", "referrer-policy": "no-referrer" }); res.end(body); };
    if (limited(ip)) { log(`${ip} "${req.method} ${u.pathname}" 429`); return finish(429); }
    if (decide(u.pathname) !== 200) { log(`${ip} "${req.method} ${u.pathname}" 404`); return finish(404, "Not found"); }   // path only: query strings (tokens) are never logged
    const headers = { ...req.headers, host: req.headers.host ?? app.host, "x-forwarded-proto": "https", "x-forwarded-for": ip };
    delete headers["x-forwarded-host"];
    const up = http.request({ host: app.hostname, port: app.port, method: req.method, path: req.url, headers, timeout: 60_000 }, (r) => { res.writeHead(r.statusCode ?? 502, { ...r.headers, "x-content-type-options": "nosniff", "strict-transport-security": "max-age=31536000", "referrer-policy": "no-referrer" }); r.pipe(res); log(`${ip} "${req.method} ${u.pathname}" ${r.statusCode}`); });
    up.on("error", () => finish(502, "Bad gateway")); up.on("timeout", () => up.destroy());
    req.pipe(up);
  });
  return server;
}

if (process.argv[1]?.endsWith("gateway.mjs")) {
  const bind = process.env.GATEWAY_BIND || "127.0.0.1", port = Number(process.env.GATEWAY_PORT || 8443);
  const s = createGateway({ tlsDir: process.env.GATEWAY_TLS_DIR, appUrl: process.env.APP_URL || "http://127.0.0.1:3000" });
  s.listen(port, bind, () => console.log(JSON.stringify({ type: "gateway_started", bind, port })));
  process.on("SIGTERM", () => s.close(() => process.exit(0)));
}
