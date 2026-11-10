#!/usr/bin/env node
// Local private CA for azee-staging-local with automated rotation. DISPOSABLE/LOCAL ONLY: never use for production.
//
//   node scripts/staging/pki.mjs init    [--dir D]            create the CA (refuses to overwrite)
//   node scripts/staging/pki.mjs rotate  [--dir D]            issue missing/expiring certs, ALWAYS refresh the CRL, write live/ atomically
//   node scripts/staging/pki.mjs revoke <identity> [--dir D] [--no-reissue]
//   node scripts/staging/pki.mjs status  [--dir D]            expiry of every live certificate (exit 1 if any expired/expiring)
//   node scripts/staging/pki.mjs watch   [--dir D] [--every-minutes 60]   loop rotate (what the rotation container runs)
//
// Layout:  <D>/ca/*  (CA key + database: keep OFF every service mount)
//          <D>/live/<identity>/{cert.pem,key.pem,ca.pem,ca.crl}   one directory per identity; mount ONLY that directory, read-only
// Files are written to a temp name then renamed, so directory bind mounts always see a complete file.
import { execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, copyFileSync, rmSync, mkdtempSync, chmodSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

export const IDENTITIES = [
  { name: "introspect", kind: "server", sans: ["DNS:introspect", "DNS:localhost", "IP:127.0.0.1"] },
  // Public HTTPS gateway. Add the LAN address the phone will use, e.g. AZEE_GATEWAY_SANS="IP:192.168.1.20,DNS:azee-staging.local"
  { name: "gateway", kind: "server", sans: ["DNS:localhost", "IP:127.0.0.1", ...(process.env.AZEE_GATEWAY_SANS || "").split(",").map((x) => x.trim()).filter(Boolean)] },
  { name: "azee-app", kind: "client" },
  { name: "aztrade-api", kind: "client" },
];
const DEFAULT = { serverDays: 30, clientDays: 14, renewFraction: 0.4, crlDays: 7 };

export function pki(dir, o = {}) {
  const opt = { ...DEFAULT, ...o };
  const ca = path.join(dir, "ca"), live = path.join(dir, "live"), cnf = path.join(ca, "openssl.cnf");
  const ossl = (args, cwd = ca) => execFileSync(process.env.OPENSSL_BIN || "openssl", args, { cwd, stdio: "pipe" });
  const atomic = (file, data, mode) => { const t = `${file}.tmp${process.pid}`; writeFileSync(t, data, mode ? { mode } : undefined); renameSync(t, file); };

  function init() {
    if (existsSync(path.join(ca, "ca.key"))) throw new Error("CA already exists; refusing to overwrite");
    mkdirSync(path.join(ca, "issued"), { recursive: true }); mkdirSync(live, { recursive: true });
    writeFileSync(path.join(ca, "index.txt"), ""); writeFileSync(path.join(ca, "serial"), "1000\n"); writeFileSync(path.join(ca, "crlnumber"), "1000\n");
    writeFileSync(cnf, `[ca]\ndefault_ca=c\n[c]\ndatabase=index.txt\nserial=serial\ncrlnumber=crlnumber\nnew_certs_dir=issued\ndefault_md=sha256\ndefault_crl_days=${opt.crlDays}\npolicy=p\nunique_subject=no\ncopy_extensions=none\n[p]\ncommonName=supplied\n[req]\ndistinguished_name=d\nprompt=no\n[d]\nCN=azee-staging-local private CA (disposable)\n[v3ca]\nbasicConstraints=critical,CA:true,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\n`);
    ossl(["req", "-x509", "-newkey", "rsa:3072", "-nodes", "-keyout", "ca.key", "-out", "ca.pem", "-days", "365", "-config", "openssl.cnf", "-extensions", "v3ca"]);
    try { chmodSync(path.join(ca, "ca.key"), 0o600); } catch { /* not supported on this filesystem */ }
    refreshCrl();
  }
  const refreshCrl = () => { ossl(["ca", "-config", "openssl.cnf", "-cert", "ca.pem", "-keyfile", "ca.key", "-gencrl", "-out", "ca.crl"]); };

  function issue(id) {
    const days = id.kind === "server" ? opt.serverDays : opt.clientDays;
    const work = mkdtempSync(path.join(tmpdir(), "pki-issue-"));
    try {
      ossl(["req", "-new", "-newkey", "rsa:2048", "-nodes", "-keyout", path.join(work, "key.pem"), "-out", path.join(work, "csr.pem"), "-subj", `/CN=${id.name}`], work);
      writeFileSync(path.join(work, "ext"), id.kind === "server" ? `subjectAltName=${id.sans.join(",")}\nextendedKeyUsage=serverAuth\nkeyUsage=digitalSignature,keyEncipherment\n` : `extendedKeyUsage=clientAuth\nkeyUsage=digitalSignature\n`);
      ossl(["ca", "-batch", "-config", "openssl.cnf", "-cert", "ca.pem", "-keyfile", "ca.key", "-in", path.join(work, "csr.pem"), "-out", path.join(work, "cert.pem"), "-extfile", path.join(work, "ext"), "-days", String(days), "-notext"]);
      const out = path.join(live, id.name); mkdirSync(out, { recursive: true });
      atomic(path.join(out, "key.pem"), readFileSync(path.join(work, "key.pem")), 0o600);
      atomic(path.join(out, "cert.pem"), readFileSync(path.join(work, "cert.pem")));
      return new X509Certificate(readFileSync(path.join(out, "cert.pem")));
    } finally { rmSync(work, { recursive: true, force: true }); }
  }

  const certOf = (id) => { const f = path.join(live, id.name, "cert.pem"); return existsSync(f) ? new X509Certificate(readFileSync(f)) : null; };
  const fraction = (c, now = Date.now()) => (Date.parse(c.validTo) - now) / (Date.parse(c.validTo) - Date.parse(c.validFrom));

  function publish() {   // CA cert + current CRL next to every identity (atomic)
    for (const id of IDENTITIES) { const out = path.join(live, id.name); if (!existsSync(out)) continue;
      atomic(path.join(out, "ca.pem"), readFileSync(path.join(ca, "ca.pem"))); atomic(path.join(out, "ca.crl"), readFileSync(path.join(ca, "ca.crl"))); }
  }
  function rotate(now = Date.now()) {
    const result = [];
    for (const id of IDENTITIES) {
      const c = certOf(id);
      const reason = !c ? "missing" : Date.parse(c.validTo) <= now ? "expired" : fraction(c, now) < opt.renewFraction ? "expiring" : null;
      if (reason) { const n = issue(id); result.push({ identity: id.name, action: "issued", reason, serial: n.serialNumber, validTo: n.validTo }); }
      else result.push({ identity: id.name, action: "kept", validTo: c.validTo });
    }
    refreshCrl(); publish();   // CRL is refreshed on EVERY run: an expired CRL makes TLS reject every client
    return result;
  }
  function revoke(name, { reissue = true } = {}) {
    const id = IDENTITIES.find((i) => i.name === name); if (!id) throw new Error(`unknown identity ${name}`);
    const c = certOf(id); if (!c) throw new Error("no live certificate to revoke");
    ossl(["ca", "-config", "openssl.cnf", "-cert", "ca.pem", "-keyfile", "ca.key", "-revoke", path.join(live, id.name, "cert.pem")]);
    refreshCrl();
    if (reissue) issue(id); else rmSync(path.join(live, id.name, "cert.pem"));
    publish();
    return { revoked: c.serialNumber, reissued: reissue };
  }
  function status(now = Date.now()) {
    return IDENTITIES.map((id) => { const c = certOf(id); return c ? { identity: id.name, validTo: c.validTo, remainingFraction: Number(fraction(c, now).toFixed(3)), expired: Date.parse(c.validTo) <= now, fingerprint256: c.fingerprint256 } : { identity: id.name, missing: true }; });
  }
  return { init, rotate, revoke, status, refreshCrl, publish, opt };
}

// ---- CLI ----
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}` || process.argv[1]?.endsWith("pki.mjs")) {
  const [cmd, ...rest] = process.argv.slice(2);
  const arg = (n, d) => { const i = rest.indexOf(`--${n}`); return i >= 0 ? rest[i + 1] : d; };
  const dir = path.resolve(arg("dir", process.env.AZEE_PKI_DIR || "secrets-staging/pki"));
  const p = pki(dir, { serverDays: Number(arg("server-days", DEFAULT.serverDays)), clientDays: Number(arg("client-days", DEFAULT.clientDays)), renewFraction: Number(arg("renew-fraction", DEFAULT.renewFraction)) });
  const print = (x) => console.log(JSON.stringify(x, null, 2));
  try {
    if (cmd === "init") { p.init(); print(p.rotate()); }
    else if (cmd === "rotate") print(p.rotate());
    else if (cmd === "revoke") print(p.revoke(rest[0], { reissue: !rest.includes("--no-reissue") }));
    else if (cmd === "status") { const s = p.status(); print(s); process.exit(s.some((x) => x.missing || x.expired || x.remainingFraction < p.opt.renewFraction) ? 1 : 0); }
    else if (cmd === "watch") { const ms = Number(arg("every-minutes", 60)) * 60_000; const tick = () => { try { print({ at: new Date().toISOString(), rotated: p.rotate() }); } catch (e) { console.error("rotation failed:", e.message); } }; tick(); setInterval(tick, ms); }
    else { console.error("usage: pki.mjs init|rotate|revoke <identity>|status|watch [--dir D]"); process.exit(2); }
  } catch (e) { console.error(e.message); process.exit(1); }
}
