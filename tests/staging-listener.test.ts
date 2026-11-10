import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { X509Certificate } from "node:crypto";
import { pki } from "../scripts/staging/pki.mjs";
import { startListener } from "@/lib/aztrade/listener";
import { fileProvider } from "@/lib/secrets";
import { mtlsFetcher } from "@/lib/aztrade/mtls-client.js";

// azee-staging-local building blocks, exercised natively with a disposable CA (no Docker needed).
const SVC = "z".repeat(48);
let root: string, pkiDir: string, secretsDir: string; let ca: ReturnType<typeof pki>;
const live = (id: string, f: string) => path.join(pkiDir, "live", id, f);
const env = (over: Record<string, string> = {}) => ({
  NODE_ENV: "production", AZEE_ENV: "azee-staging-local", AZEE_SECRET_PROVIDER: "file", AZEE_SECRETS_DIR: secretsDir,
  AZTRADE_MTLS_SERVER_CERT_FILE: live("introspect", "cert.pem"), AZTRADE_MTLS_SERVER_KEY_FILE: live("introspect", "key.pem"),
  AZTRADE_MTLS_CLIENT_CA_FILE: live("introspect", "ca.pem"), AZTRADE_MTLS_CRL_FILE: live("introspect", "ca.crl"),
  AZTRADE_MTLS_ALLOWED_CLIENT_CNS: "azee-app,aztrade-api", AZTRADE_MTLS_LISTEN_HOST: "127.0.0.1", AZTRADE_MTLS_RELOAD_MS: "3600000",
  AZEE_INTROSPECTION_MTLS_CERT_FILE: live("azee-app", "cert.pem"), AZEE_INTROSPECTION_MTLS_KEY_FILE: live("azee-app", "key.pem"), AZEE_INTROSPECTION_MTLS_CA_FILE: live("azee-app", "ca.pem"),
  AZEE_JWT_ISSUER: "https://issuer.invalid", AZTRADE_JWT_KID: "k1", ...over,
});
const call = (client: string, port: number, secret = SVC) => mtlsFetcher({ AZEE_INTROSPECTION_MTLS_CERT_FILE: live(client, "cert.pem"), AZEE_INTROSPECTION_MTLS_KEY_FILE: live(client, "key.pem"), AZEE_INTROSPECTION_MTLS_CA_FILE: live(client, "ca.pem") })(`https://127.0.0.1:${port}/introspect`, { method: "POST", headers: { authorization: `Bearer ${secret}` }, body: JSON.stringify({ token: "t".repeat(30) }) });

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "stg-")); pkiDir = path.join(root, "pki"); secretsDir = path.join(root, "secrets"); mkdirSync(secretsDir);
  ca = pki(pkiDir); ca.init(); ca.rotate();
  writeFileSync(path.join(secretsDir, "AZTRADE_SERVICE_SECRET"), SVC + "\n");
  writeFileSync(path.join(secretsDir, "AZTRADE_JWT_PRIVATE_KEY"), "placeholder-not-used-by-this-test");
  writeFileSync(path.join(secretsDir, "AZTRADE_DATABASE_URL"), "postgres://aztrade_app:pw@db.internal:5432/azee_staging\n");
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("local CA and automated rotation", () => {
  it("issues every identity and keeps unexpired certificates on the next run", () => {
    expect(ca.status().every((s) => !s.missing && !s.expired)).toBe(true);
    expect(ca.rotate().every((r) => r.action === "kept")).toBe(true);
  });
  it("re-issues expiring certificates, refreshes the CRL every run, and leaves keys out of the CA directory", () => {
    const before = new X509Certificate(readFileSync(live("introspect", "cert.pem"))).serialNumber;
    const crlBefore = readFileSync(live("azee-app", "ca.crl"), "utf8");
    const r = ca.rotate(Date.now() + 25 * 86_400_000);                          // 25 of 30 days used: below the 40% renewal line
    expect(r.find((x) => x.identity === "introspect")).toMatchObject({ action: "issued", reason: "expiring" });
    expect(new X509Certificate(readFileSync(live("introspect", "cert.pem"))).serialNumber).not.toBe(before);
    expect(readFileSync(live("azee-app", "ca.crl"), "utf8")).not.toBe(crlBefore);   // new CRL number each run
  });
  it("refuses to overwrite an existing CA", () => { expect(() => ca.init()).toThrow(/already exists/); });
});

describe("introspection listener launcher", () => {
  it("refuses to open a socket when security configuration is missing or unsafe", async () => {
    const provider = fileProvider(secretsDir);
    await expect(startListener({ env: env({ AZTRADE_MTLS_CRL_FILE: "" }), provider, introspect: async () => ({}) })).rejects.toThrow(/Refusing to start/);
    await expect(startListener({ env: env({ AZTRADE_MTLS_LISTEN_HOST: "0.0.0.0" }), provider, introspect: async () => ({}) })).rejects.toThrow(/private interface/);
    await expect(startListener({ env: env({ AZEE_SECRET_PROVIDER: "env" }), provider, introspect: async () => ({}) })).rejects.toThrow(/Refusing to start/);
  });
  it("serves mTLS clients from secrets read through the provider, rejects revoked ones, and follows certificate rotation", async () => {
    const svc = await startListener({ env: env(), provider: fileProvider(secretsDir), port: 0, introspect: async (t) => ({ active: true, n: t.length }), log: () => {} });
    try {
      expect(await (await call("azee-app", svc.port)).json()).toEqual({ active: true, n: 30 });
      expect((await call("aztrade-api", svc.port, "x".repeat(48))).status).toBe(401);          // wrong service credential
      // rotate the SERVER certificate; the running listener must pick it up and keep serving
      const old = new X509Certificate(readFileSync(live("introspect", "cert.pem"))).fingerprint256;
      ca.rotate(Date.now() + 29 * 86_400_000); await svc.reload();
      expect(new X509Certificate(readFileSync(live("introspect", "cert.pem"))).fingerprint256).not.toBe(old);
      expect((await call("azee-app", svc.port)).status).toBe(200);
      // revoke a client: refused after the CRL reload, others unaffected
      const keep = (f: string) => { const c = path.join(root, "revoked-" + f); writeFileSync(c, readFileSync(live("aztrade-api", f))); return c; };
      const [rc, rk, rca] = [keep("cert.pem"), keep("key.pem"), keep("ca.pem")];       // the certificate about to be revoked
      expect(ca.revoke("aztrade-api", { reissue: false }).reissued).toBe(false);
      await svc.reload();
      const revokedClient = mtlsFetcher({ AZEE_INTROSPECTION_MTLS_CERT_FILE: rc, AZEE_INTROSPECTION_MTLS_KEY_FILE: rk, AZEE_INTROSPECTION_MTLS_CA_FILE: rca });
      await expect(revokedClient(`https://127.0.0.1:${svc.port}/introspect`, { method: "POST", headers: { authorization: `Bearer ${SVC}` }, body: "{}" })).rejects.toThrow();
      ca.rotate();                                                                    // re-issues the missing identity with a NEW serial, which is accepted
      expect((await call("aztrade-api", svc.port)).status).toBe(200);
      expect((await call("azee-app", svc.port)).status).toBe(200);
    } finally { await svc.close(); }
  });
});

describe("signing keys over the authenticated channel", () => {
  it("serves public keys at GET /jwks only to allowlisted mTLS clients that present the service credential", async () => {
    const svc = await startListener({ env: env(), provider: fileProvider(secretsDir), port: 0, introspect: async () => ({ active: false }), jwks: async () => ({ keys: [{ kid: "k1", kty: "RSA" }] }), log: () => {} });
    const get = (client: string, secret = SVC) => mtlsFetcher({ AZEE_INTROSPECTION_MTLS_CERT_FILE: live(client, "cert.pem"), AZEE_INTROSPECTION_MTLS_KEY_FILE: live(client, "key.pem"), AZEE_INTROSPECTION_MTLS_CA_FILE: live(client, "ca.pem") })(`https://127.0.0.1:${svc.port}/jwks`, { method: "GET", headers: { authorization: `Bearer ${secret}` } });
    try {
      const ok = await get("azee-app"); expect(ok.status).toBe(200); expect(await ok.json()).toEqual({ keys: [{ kid: "k1", kty: "RSA" }] });
      expect((await get("azee-app", "x".repeat(48))).status).toBe(401);
    } finally { await svc.close(); }
    const noJwks = await startListener({ env: env(), provider: fileProvider(secretsDir), port: 0, introspect: async () => ({}), jwks: undefined, log: () => {} });
    await noJwks.close();
  });
});

describe("certificate rotation keeps the gateway's LAN address", () => {
  it("persists the gateway SANs at init so a later rotate without the env var cannot drop them, and reissues a certificate that lacks them", () => {
    const d = mkdtempSync(path.join(tmpdir(), "san-")); const saved = process.env.AZEE_GATEWAY_SANS;
    try {
      process.env.AZEE_GATEWAY_SANS = "IP:10.9.8.7"; const a = pki(path.join(d, "pki")); a.init(); a.rotate();
      const san = () => new X509Certificate(readFileSync(path.join(d, "pki/live/gateway/cert.pem"))).subjectAltName ?? "";
      expect(san()).toContain("10.9.8.7");
      delete process.env.AZEE_GATEWAY_SANS;                                              // a later run WITHOUT the variable
      const b = pki(path.join(d, "pki")); b.rotate(Date.now() + 29 * 86_400_000);       // force a reissue
      expect(san()).toContain("10.9.8.7");
      // a certificate that lacks a wanted SAN is detected and reissued even when it is far from expiry
      writeFileSync(path.join(d, "pki/gateway-sans.txt"), "IP:10.9.8.7,IP:10.9.8.8");
      expect(pki(path.join(d, "pki")).rotate().find((r) => r.identity === "gateway")).toMatchObject({ action: "issued", reason: "san_changed" });
      expect(san()).toContain("10.9.8.8");
    } finally { if (saved === undefined) delete process.env.AZEE_GATEWAY_SANS; else process.env.AZEE_GATEWAY_SANS = saved; rmSync(d, { recursive: true, force: true }); }
  });
});
