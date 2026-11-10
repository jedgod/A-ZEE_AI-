#!/usr/bin/env node
// Probes the LIVE private mTLS listener (native stack) with a chosen client identity. Prints one line: STATUS <code> or REFUSED.
//   node scripts/staging/native-mtls-probe.mjs --identity azee-app [--pki <dir>] [--secret <s>] [--path /introspect] [--no-cert]
import { readFileSync } from "node:fs";
import https from "node:https";
import path from "node:path";

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const base = arg("base", "G:\\A-Z_AI\\staging-local");
const identity = arg("identity", "azee-app"), pkiDir = arg("pki", path.join(base, "pki"));
const secret = arg("secret", readFileSync(path.join(base, "secrets/AZTRADE_SERVICE_SECRET"), "utf8").trim());
const trustCa = readFileSync(path.join(base, "pki/live/azee-app/ca.pem"));           // always trust the REAL CA for the server side
const live = path.join(pkiDir, "live", identity);
const opts = { host: "localhost", port: 18443, path: arg("path", "/introspect"), method: arg("method", "POST"), ca: trustCa, servername: "localhost", timeout: 8000,
  headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
  ...(process.argv.includes("--no-cert") ? {} : { cert: readFileSync(path.join(live, "cert.pem")), key: readFileSync(path.join(live, "key.pem")) }) };
const req = https.request(opts, (res) => { res.resume(); res.on("end", () => console.log(`STATUS ${res.statusCode}`)); });
req.on("error", () => console.log("REFUSED")); req.on("timeout", () => { req.destroy(); });
req.end(opts.method === "POST" ? JSON.stringify({ token: "x".repeat(30) }) : undefined);
