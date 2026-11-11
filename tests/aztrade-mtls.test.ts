import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMtlsIntrospectServer } from "@/lib/aztrade/mtls";
import { createRequire } from "node:module";

// Disposable PKI generated per run: nothing here is, or resembles, a real credential.
const { mtlsFetcher } = await import("@/lib/aztrade/mtls-client.js") as any;
const SECRET = "s".repeat(40);
let dir: string; const logs: string[] = [];
const ossl = (...args: string[]) => execFileSync("openssl", args, { cwd: dir, stdio: "pipe" });
const w = (f: string, t: string) => writeFileSync(path.join(dir, f), t);

function makeCa(name: string) {
  mkdirSync(path.join(dir, name)); w(`${name}/index.txt`, ""); w(`${name}/serial`, "01\n"); w(`${name}/crlnumber`, "01\n");
  w(`${name}.cnf`, `[ca]\ndefault_ca=c\n[c]\ndatabase=${name}/index.txt\nserial=${name}/serial\ncrlnumber=${name}/crlnumber\nnew_certs_dir=${name}\ndefault_md=sha256\ndefault_days=2\ndefault_crl_days=1\npolicy=p\nunique_subject=no\ncopy_extensions=none\n[p]\ncommonName=supplied\n[req]\ndistinguished_name=d\nprompt=no\n[d]\nCN=${name}\n[v3ca]\nbasicConstraints=critical,CA:true\nkeyUsage=keyCertSign,cRLSign\n`);
  ossl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", `${name}.key`, "-out", `${name}.pem`, "-days", "2", "-config", `${name}.cnf`, "-extensions", "v3ca");
}
function leaf(ca: string, cn: string, server = false) {
  ossl("req", "-new", "-newkey", "rsa:2048", "-nodes", "-keyout", `${cn}.key`, "-out", `${cn}.csr`, "-subj", `/CN=${cn}`);
  w(`${cn}.ext`, server ? "subjectAltName=IP:127.0.0.1,DNS:localhost\nextendedKeyUsage=serverAuth\n" : "extendedKeyUsage=clientAuth\n");
  ossl("ca", "-batch", "-config", `${ca}.cnf`, "-cert", `${ca}.pem`, "-keyfile", `${ca}.key`, "-in", `${cn}.csr`, "-out", `${cn}.pem`, "-extfile", `${cn}.ext`, "-notext");
}
const crl = (ca: string) => ossl("ca", "-config", `${ca}.cnf`, "-cert", `${ca}.pem`, "-keyfile", `${ca}.key`, "-gencrl", "-out", `${ca}.crl`);
const f = (n: string) => path.join(dir, n);
const clientEnv = (cn: string, ca = "serverca") => ({ AZEE_INTROSPECTION_MTLS_CERT_FILE: f(`${cn}.pem`), AZEE_INTROSPECTION_MTLS_KEY_FILE: f(`${cn}.key`), AZEE_INTROSPECTION_MTLS_CA_FILE: f(`${ca}.pem`) });

let svc: Awaited<ReturnType<typeof createMtlsIntrospectServer>>; let url: string; let clock = Date.now();
const call = (cn: string, secret = SECRET, token: any = "t".repeat(30)) => mtlsFetcher(clientEnv(cn))(url, { method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" }, body: JSON.stringify({ token }) });

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "mtls-"));
  makeCa("serverca"); makeCa("clientca"); makeCa("othera");
  leaf("serverca", "server", true);
  leaf("clientca", "aztrade-api"); leaf("clientca", "other-service"); leaf("clientca", "revoked-api"); leaf("clientca", "denied-api"); leaf("othera", "rogue");
  // clients validate the server with serverca; make a client key/cert pair readable under that name too
  crl("clientca");
  const denyFp = execFileSync("openssl", ["x509", "-in", f("denied-api.pem"), "-noout", "-fingerprint", "-sha256"], { encoding: "utf8" }).split("=")[1].trim();
  svc = await createMtlsIntrospectServer({
    keyFile: f("server.key"), certFile: f("server.pem"), clientCaFile: f("clientca.pem"), crlFile: f("clientca.crl"),
    allowedClientCommonNames: ["aztrade-api", "revoked-api", "denied-api"], deniedClientFingerprints: [denyFp],
    serviceSecret: SECRET, now: () => clock, reloadMs: 3_600_000, maxStaleMs: 60_000, log: (e) => logs.push(JSON.stringify(e)),
    ai: async (body) => ({status:202,body:{length:body.length}}),
    introspect: async (token) => { if (token === "boom") throw new Error("db down"); return { active: true, echo: token.length }; },
  });
  url = `https://127.0.0.1:${await svc.listen(0, "127.0.0.1")}/introspect`;
});
afterAll(async () => { await svc?.close(); rmSync(dir, { recursive: true, force: true }); });

describe("/introspect over mTLS (disposable certificates)", () => {
  it("protects AI relay with the same client and service authentication", async()=>{
    const invoke=(cn:string,secret=SECRET,body='{}')=>mtlsFetcher(clientEnv(cn))(url.replace('/introspect','/ai'),{method:'POST',headers:{authorization:`Bearer ${secret}`},body});
    expect((await invoke('aztrade-api')).status).toBe(202);
    expect((await invoke('aztrade-api','wrong')).status).toBe(401);
    expect((await invoke('other-service')).status).toBe(403);
    expect((await invoke('aztrade-api',SECRET,'x'.repeat(64001))).status).toBe(413);
  });
  it("answers an allowlisted client with a valid certificate and the service credential", async () => {
    const r = await call("aztrade-api"); expect(r.status).toBe(200); expect(await r.json()).toEqual({ active: true, echo: 30 });
  });
  it("refuses a client with no certificate at the TLS layer", async () => {
    const https = await import("node:https");
    await expect(new Promise((ok, bad) => { const q = https.request(url, { method: "POST", ca: readFileSync(f("serverca.pem")) }, (res) => ok(res.statusCode)); q.on("error", bad); q.end("{}"); })).rejects.toBeDefined();
  });
  it("refuses a certificate issued by an untrusted CA", async () => { await expect(call("rogue")).rejects.toThrow(); });
  it("refuses a valid-but-not-allowlisted identity (403) even with the right credential", async () => { expect((await call("other-service")).status).toBe(403); });
  it("refuses a denylisted fingerprint", async () => { expect((await call("denied-api")).status).toBe(403); });
  it("still requires the service credential", async () => { expect((await call("aztrade-api", "x".repeat(40))).status).toBe(401); });
  it("rejects malformed input without echoing it", async () => { expect((await call("aztrade-api", SECRET, 5)).status).toBe(400); });
  it("fails closed with 503 when introspection is unavailable", async () => { expect((await call("aztrade-api", SECRET, "boom")).status).toBe(503); });
  it("enforces revocation: a certificate revoked in the CRL is refused after the CRL reloads", async () => {
    expect((await call("revoked-api")).status).toBe(200);                       // valid until revoked
    ossl("ca", "-config", "clientca.cnf", "-cert", "clientca.pem", "-keyfile", "clientca.key", "-revoke", "revoked-api.pem"); crl("clientca");
    await svc.reload();
    await expect(call("revoked-api")).rejects.toThrow();
    expect((await call("aztrade-api")).status).toBe(200);                       // others unaffected
  });
  it("goes 503 for everything when credentials have not been refreshed within the staleness limit", async () => {
    clock += 120_000; expect((await call("aztrade-api")).status).toBe(503);
    await svc.reload(); expect((await call("aztrade-api")).status).toBe(200);   // a successful reload restores service
  });
  it("never logs tokens or credentials", () => { const all = logs.join("\n"); expect(all).not.toContain(SECRET); expect(all).not.toContain("tttttt"); });
});
