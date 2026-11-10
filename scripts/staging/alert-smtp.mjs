#!/usr/bin/env node
// SMTP email delivery for maintenance/ops alerts. NO PROVIDER, host or credential is assumed: nothing is sent unless ALL required settings are
// provided, and the exit code says so. Plug it into the supervisor:   ALERT_COMMAND="node scripts/staging/alert-smtp.mjs"
// The alert JSON arrives on stdin (see maintenance-supervisor.mjs). Exit codes: 0 sent, 3 NOT configured (nothing sent), 1 delivery failed.
//
// Settings (names only; values come from the environment or mounted secret files - never from the repo):
//   SMTP_HOST, SMTP_PORT              server (required)
//   SMTP_SECURITY = tls | starttls    implicit TLS (usually 465) or STARTTLS (usually 587). Plain text is NOT supported. (required)
//   SMTP_USER, SMTP_PASSWORD_FILE     optional AUTH (PLAIN) credentials; the password is read from that file, never from an env value
//   SMTP_CA_FILE                      optional extra CA (private relay). Certificate verification is ALWAYS on.
//   ALERT_MAIL_FROM, ALERT_MAIL_TO    envelope/header addresses; TO may be a comma-separated list (required)
//   SMTP_TIMEOUT_MS                   default 15000
import net from "node:net";
import tls from "node:tls";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const ADDRESS = /^[A-Za-z0-9._%+'-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,}$/;
const clean = (s) => String(s ?? "").replace(/[\r\n\0]+/g, " ").trim();          // header injection: no line breaks in any header value

export function smtpSettings(env = process.env) {
  const missing = ["SMTP_HOST", "SMTP_PORT", "SMTP_SECURITY", "ALERT_MAIL_FROM", "ALERT_MAIL_TO"].filter((k) => !env[k]);
  if (missing.length) return { ok: false, reason: `not configured (missing ${missing.join(", ")})` };
  if (!["tls", "starttls"].includes(env.SMTP_SECURITY)) return { ok: false, reason: "SMTP_SECURITY must be tls or starttls (plain text is not supported)" };
  const to = env.ALERT_MAIL_TO.split(",").map((s) => s.trim()).filter(Boolean);
  if (!ADDRESS.test(env.ALERT_MAIL_FROM) || !to.length || !to.every((a) => ADDRESS.test(a))) return { ok: false, reason: "invalid ALERT_MAIL_FROM or ALERT_MAIL_TO" };
  if (!/^[A-Za-z0-9.-]{1,253}$/.test(env.SMTP_HOST)) return { ok: false, reason: "invalid SMTP_HOST" };
  const port = Number(env.SMTP_PORT); if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, reason: "invalid SMTP_PORT" };
  if ((env.SMTP_USER && !env.SMTP_PASSWORD_FILE) || (!env.SMTP_USER && env.SMTP_PASSWORD_FILE)) return { ok: false, reason: "SMTP_USER and SMTP_PASSWORD_FILE must be set together" };
  return { ok: true, host: env.SMTP_HOST, port, security: env.SMTP_SECURITY, from: env.ALERT_MAIL_FROM, to,
    user: env.SMTP_USER || null, passwordFile: env.SMTP_PASSWORD_FILE || null, caFile: env.SMTP_CA_FILE || null, timeoutMs: Number(env.SMTP_TIMEOUT_MS || 15000) };
}

/** Subject and body for an alert. Only the fields the supervisor emits are used; nothing from a request, prompt or account is ever included. */
export function formatAlert(a) {
  const sev = clean(a.severity || "info").toUpperCase();
  const subject = `[${sev}] ${clean(a.event || "alert")} (${clean(a.owner || "unowned")})`;
  const lines = [`Event:    ${clean(a.event)}`, `Severity: ${clean(a.severity)}`, `Time:     ${clean(a.at)}`, `Owner:    ${clean(a.owner)}`, `Runbook:  ${clean(a.runbook)}`, "", "Detail:",
    ...Object.entries(a.detail ?? {}).slice(0, 12).map(([k, v]) => `  ${clean(k).slice(0, 40)}: ${clean(typeof v === "object" ? JSON.stringify(v) : v).slice(0, 300)}`)];
  return { subject, text: lines.join("\r\n") };
}

export function buildMessage({ from, to, subject, text, now = new Date() }) {
  const body = String(text).replace(/\r?\n/g, "\r\n").split("\r\n").map((l) => (l.startsWith(".") ? "." + l : l)).join("\r\n");   // dot-stuffing
  return [`From: ${clean(from)}`, `To: ${to.map(clean).join(", ")}`, `Subject: ${clean(subject).slice(0, 200)}`, `Date: ${now.toUTCString()}`, `Message-ID: <${randomUUID()}@alerts.local>`,
    "MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: 8bit", "", body, ""].join("\r\n");
}

/** Minimal line-oriented SMTP conversation. Resolves with the last reply code and text, rejects on any unexpected status. */
function conversation(socket, timeoutMs) {
  let buf = ""; const waiting = []; let failure = null;
  const flush = () => { while (waiting.length) { const m = buf.match(/^(?:\d{3}-.*\r?\n)*\d{3} .*\r?\n/); if (!m) return; buf = buf.slice(m[0].length); const text = m[0]; waiting.shift().ok({ code: Number(text.slice(0, 3)), text }); } };
  const onData = (d) => { buf += d.toString("utf8"); if (buf.length > 65536) fail(new Error("reply too large")); flush(); };
  const fail = (e) => { failure = e; while (waiting.length) waiting.shift().bad(e); socket.destroy(); };
  socket.on("data", onData); socket.on("error", fail); socket.on("close", () => fail(failure ?? new Error("connection closed")));
  socket.setTimeout(timeoutMs, () => fail(new Error("timeout")));
  return {
    reply: () => (failure ? Promise.reject(failure) : new Promise((ok, bad) => { waiting.push({ ok, bad }); flush(); })),
    send: (line) => socket.write(line + "\r\n"),
    rewire: (s) => { socket.removeListener("data", onData); s.on("data", onData); s.on("error", fail); s.on("close", () => fail(failure ?? new Error("connection closed"))); s.setTimeout(timeoutMs, () => fail(new Error("timeout"))); socket = s; buf = ""; },
    sock: () => socket,
  };
}

export async function sendMail(settings, message) {
  const ca = settings.caFile ? [readFileSync(settings.caFile), ...tls.rootCertificates] : undefined;
  const tlsOptions = { host: settings.host, servername: settings.host, rejectUnauthorized: true, minVersion: "TLSv1.2", ...(ca ? { ca } : {}) };
  const socket = await new Promise((ok, bad) => {
    const s = settings.security === "tls" ? tls.connect({ ...tlsOptions, port: settings.port }, () => ok(s)) : net.connect({ host: settings.host, port: settings.port }, () => ok(s));
    s.once("error", bad); s.setTimeout(settings.timeoutMs, () => bad(new Error("connect timeout")));
  });
  const c = conversation(socket, settings.timeoutMs);
  const expect = async (codes, what) => { const r = await c.reply(); if (!codes.includes(r.code)) throw new Error(`${what}: unexpected ${r.code}`); return r; };
  try {
    await expect([220], "greeting");
    c.send("EHLO alerts.local"); await expect([250], "EHLO");
    if (settings.security === "starttls") {
      c.send("STARTTLS"); await expect([220], "STARTTLS");
      const upgraded = await new Promise((ok, bad) => { const t = tls.connect({ ...tlsOptions, socket: c.sock() }, () => ok(t)); t.once("error", bad); });
      c.rewire(upgraded); c.send("EHLO alerts.local"); await expect([250], "EHLO after STARTTLS");
    }
    if (settings.user) {                                                                       // credentials only ever travel inside verified TLS
      const pass = readFileSync(settings.passwordFile, "utf8").replace(/\r?\n$/, "");
      c.send("AUTH PLAIN " + Buffer.from(`\0${settings.user}\0${pass}`).toString("base64")); await expect([235], "authentication");
    }
    c.send(`MAIL FROM:<${settings.from}>`); await expect([250], "MAIL FROM");
    for (const rcpt of settings.to) { c.send(`RCPT TO:<${rcpt}>`); await expect([250, 251], "RCPT TO"); }
    c.send("DATA"); await expect([354], "DATA");
    c.sock().write(buildMessage({ from: settings.from, to: settings.to, subject: message.subject, text: message.text }) + ".\r\n"); await expect([250], "message accepted");
    c.send("QUIT"); return { sent: true, recipients: settings.to.length };
  } finally { c.sock().destroy(); }
}

if (process.argv[1]?.endsWith("alert-smtp.mjs")) {
  const s = smtpSettings();
  if (!s.ok) { console.error(JSON.stringify({ type: "alert_email_skipped", reason: s.reason })); process.exit(3); }
  let raw = ""; process.stdin.setEncoding("utf8"); for await (const chunk of process.stdin) { raw += chunk; if (raw.length > 65536) break; }
  let alert; try { alert = JSON.parse(raw); } catch { console.error(JSON.stringify({ type: "alert_email_failed", reason: "stdin is not alert JSON" })); process.exit(1); }
  try { const r = await sendMail(s, formatAlert(alert)); console.log(JSON.stringify({ type: "alert_email_sent", recipients: r.recipients, event: clean(alert.event) })); }
  catch (e) { console.error(JSON.stringify({ type: "alert_email_failed", reason: String(e.message).slice(0, 120) })); process.exit(1); }   // never echoes credentials
}
