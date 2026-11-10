import { describe, it, expect, beforeAll, afterAll } from "vitest";
import net from "node:net";
import tls from "node:tls";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createPki } from "./helpers/pki";
import { buildMessage, formatAlert, sendMail, smtpSettings } from "../scripts/staging/alert-smtp.mjs";

// A fake SMTP server (no real mail provider is involved or assumed). It records every command so the tests can assert what was and was not sent.
type Fake = { port: number; commands: string[]; data: string[]; close: () => void };
function fakeSmtp(mode: "tls" | "starttls", key: Buffer, cert: Buffer, opts: { auth?: string; refuseStarttls?: boolean } = {}): Promise<Fake> {
  const commands: string[] = [], data: string[] = []; const ctx = tls.createSecureContext({ key, cert });
  const handle = (sock: net.Socket | tls.TLSSocket, upgrade?: (s: net.Socket) => void, greet = true) => {
    let buf = "", inData = false, body = "";
    const reply = (t: string) => sock.write(t + "\r\n");
    sock.on("error", () => {});
    sock.on("data", (d) => {
      buf += d.toString("utf8");
      for (;;) {
        if (inData) { const i = buf.indexOf("\r\n.\r\n"); if (i < 0) { return; } body += buf.slice(0, i); buf = buf.slice(i + 5); inData = false; data.push(body); body = ""; reply("250 queued"); continue; }
        const nl = buf.indexOf("\r\n"); if (nl < 0) return; const line = buf.slice(0, nl); buf = buf.slice(nl + 2);
        const cmd = line.split(" ")[0].toUpperCase(); commands.push(cmd === "AUTH" ? "AUTH <redacted>" : line);
        if (cmd === "EHLO") reply("250-fake\r\n250 AUTH PLAIN");
        else if (cmd === "STARTTLS") { if (opts.refuseStarttls) reply("454 TLS not available"); else { reply("220 go ahead"); upgrade?.(sock as net.Socket); return; } }
        else if (cmd === "AUTH") reply(line.split(" ")[2] === opts.auth ? "235 ok" : "535 bad");
        else if (cmd === "MAIL" || cmd === "RCPT") reply("250 ok");
        else if (cmd === "DATA") { reply("354 go"); inData = true; }
        else if (cmd === "QUIT") { reply("221 bye"); sock.end(); }
        else reply("500 ?");
      }
    });
    if (greet) reply("220 fake ESMTP");        // a real server does not greet again after STARTTLS
  };
  const server = mode === "tls" ? tls.createServer({ key, cert }, (s) => handle(s)) : net.createServer((raw) => handle(raw, (s) => { const t = new tls.TLSSocket(s, { isServer: true, secureContext: ctx }); handle(t, undefined, false); }));
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok({ port: (server.address() as net.AddressInfo).port, commands, data, close: () => server.close() })));
}

let dir: string, pki: ReturnType<typeof createPki>, pw: string, key: Buffer, cert: Buffer;
beforeAll(() => {
  pki = createPki(); pki.ca("smtpca"); pki.ca("evilca"); pki.leaf("smtpca", "mail", "localhost", { server: true }); pki.leaf("evilca", "evilmail", "localhost", { server: true });
  dir = mkdtempSync(path.join(tmpdir(), "smtp-")); pw = path.join(dir, "pw"); writeFileSync(pw, "s3cret-pass\n");
  key = readFileSync(pki.f("mail.key")); cert = readFileSync(pki.f("mail.pem"));
});
afterAll(() => { pki.cleanup(); rmSync(dir, { recursive: true, force: true }); });
const settings = (over: Record<string, unknown>, port: number) => {
  const s = smtpSettings({ SMTP_HOST: "localhost", SMTP_PORT: String(port), SMTP_SECURITY: "tls", ALERT_MAIL_FROM: "alerts@example.test", ALERT_MAIL_TO: "ops@example.test, lead@example.test", SMTP_CA_FILE: pki.f("smtpca.pem"), SMTP_TIMEOUT_MS: "4000", ...over } as any);
  if (!s.ok) throw new Error(s.reason); return s;
};
const alert = { at: "2026-11-10T16:00:00Z", severity: "critical", event: "quota_reconciliation_mismatch", owner: "azee-staging-owner", runbook: "docs/runbooks/inference-maintenance.md", detail: { consecutiveFailures: 1, message: "mismatch" } };

describe("settings: nothing is assumed", () => {
  it("is NOT configured by default and says exactly what is missing", () => {
    const s = smtpSettings({}); expect(s.ok).toBe(false); expect((s as any).reason).toMatch(/SMTP_HOST.*SMTP_PORT.*SMTP_SECURITY.*ALERT_MAIL_FROM.*ALERT_MAIL_TO/);
  });
  it("refuses plain-text SMTP, bad addresses, bad ports and half-set credentials", () => {
    const ok = { SMTP_HOST: "h.example", SMTP_PORT: "587", SMTP_SECURITY: "starttls", ALERT_MAIL_FROM: "a@example.test", ALERT_MAIL_TO: "b@example.test" };
    expect(smtpSettings(ok).ok).toBe(true);
    for (const bad of [{ SMTP_SECURITY: "none" }, { SMTP_SECURITY: "plain" }, { ALERT_MAIL_TO: "not-an-address" }, { ALERT_MAIL_FROM: "a@b\r\nBcc: x@y.zz" }, { SMTP_PORT: "0" }, { SMTP_PORT: "abc" }, { SMTP_HOST: "bad host" }, { SMTP_USER: "u" }, { SMTP_PASSWORD_FILE: "/x" }])
      expect(smtpSettings({ ...ok, ...bad }).ok, JSON.stringify(bad)).toBe(false);
  });
});

describe("delivery", () => {
  it("delivers over implicit TLS with AUTH, to every recipient, with the alert content", async () => {
    const f = await fakeSmtp("tls", key, cert, { auth: Buffer.from("\0alert-user\0s3cret-pass").toString("base64") });
    try {
      const r = await sendMail(settings({ SMTP_USER: "alert-user", SMTP_PASSWORD_FILE: pw }, f.port), formatAlert(alert));
      expect(r).toEqual({ sent: true, recipients: 2 });
      expect(f.commands).toEqual(expect.arrayContaining(["MAIL FROM:<alerts@example.test>", "RCPT TO:<ops@example.test>", "RCPT TO:<lead@example.test>", "DATA"]));
      expect(f.data[0]).toMatch(/Subject: \[CRITICAL\] quota_reconciliation_mismatch \(azee-staging-owner\)/); expect(f.data[0]).toContain("Runbook:  docs/runbooks/inference-maintenance.md");
      expect(JSON.stringify(f.commands)).not.toContain("s3cret-pass");
    } finally { f.close(); }
  });
  it("delivers over STARTTLS and only authenticates AFTER the upgrade", async () => {
    const f = await fakeSmtp("starttls", key, cert, { auth: Buffer.from("\0alert-user\0s3cret-pass").toString("base64") });
    try {
      await sendMail(settings({ SMTP_SECURITY: "starttls", SMTP_USER: "alert-user", SMTP_PASSWORD_FILE: pw }, f.port), formatAlert(alert));
      const order = f.commands.map((c) => c.split(" ")[0]); expect(order.indexOf("STARTTLS")).toBeGreaterThan(-1); expect(order.indexOf("AUTH")).toBeGreaterThan(order.indexOf("STARTTLS"));
    } finally { f.close(); }
  });
  it("refuses to continue when the server will not upgrade to TLS: credentials are never sent in clear text", async () => {
    const f = await fakeSmtp("starttls", key, cert, { refuseStarttls: true });
    try { await expect(sendMail(settings({ SMTP_SECURITY: "starttls", SMTP_USER: "alert-user", SMTP_PASSWORD_FILE: pw }, f.port), formatAlert(alert))).rejects.toThrow(/STARTTLS/); expect(f.commands.some((c) => c.startsWith("AUTH"))).toBe(false); }
    finally { f.close(); }
  });
  it("verifies the server certificate: one from an untrusted CA fails and no credential is sent", async () => {
    const f = await fakeSmtp("tls", readFileSync(pki.f("evilmail.key")), readFileSync(pki.f("evilmail.pem")));
    try { await expect(sendMail(settings({ SMTP_USER: "alert-user", SMTP_PASSWORD_FILE: pw }, f.port), formatAlert(alert))).rejects.toThrow(); expect(f.commands).toEqual([]); }
    finally { f.close(); }
  });
  it("fails (not silently) on a rejected login, a closed port and a server that never answers", async () => {
    const f = await fakeSmtp("tls", key, cert, { auth: "different" });
    try { await expect(sendMail(settings({ SMTP_USER: "alert-user", SMTP_PASSWORD_FILE: pw }, f.port), formatAlert(alert))).rejects.toThrow(/authentication/); } finally { f.close(); }
    await expect(sendMail(settings({}, 1), formatAlert(alert))).rejects.toThrow();
    const socks: net.Socket[] = []; const hang = net.createServer((s) => { socks.push(s); s.on("error", () => {}); }); await new Promise<void>((ok) => hang.listen(0, "127.0.0.1", ok));
    try { await expect(sendMail(settings({ SMTP_TIMEOUT_MS: "600" }, (hang.address() as net.AddressInfo).port), formatAlert(alert))).rejects.toThrow(); } finally { socks.forEach((s) => s.destroy()); hang.close(); }
  });
});

describe("message safety", () => {
  it("cannot be used for header injection or SMTP smuggling", () => {
    const evil = { ...alert, event: "x\r\nBcc: attacker@example.test", owner: "o\nSubject: forged", detail: { m: "line1\r\n.\r\nMAIL FROM:<a@b.cc>" } };
    const { subject, text } = formatAlert(evil); expect(subject).not.toMatch(/[\r\n]/);
    const msg = buildMessage({ from: "a@example.test", to: ["b@example.test"], subject, text: text + "\r\n.hidden\r\n.\r\nQUIT" });
    const headers = msg.split("\r\n\r\n")[0]; expect(headers).not.toMatch(/^Bcc:/m); expect(headers.split("\r\n").filter((l) => /^subject:/i.test(l))).toHaveLength(1);
    expect(msg).toContain("\r\n..hidden"); expect(msg).not.toMatch(/\r\n\.\r\n(?!$)/);                      // dot-stuffed: no early end-of-data
  });
  it("never includes more than the supervisor's own alert fields and bounds their size", () => {
    const { text } = formatAlert({ ...alert, detail: { message: "x".repeat(5000), a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, j: 10, k: 11, l: 12, m: 13, n: 14 } });
    expect(text.length).toBeLessThan(3000); expect(text.split("\r\n").filter((l) => l.startsWith("  ")).length).toBeLessThanOrEqual(12);
  });
});
