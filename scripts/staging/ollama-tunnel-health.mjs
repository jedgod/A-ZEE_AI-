#!/usr/bin/env node
// Health monitor for the Ollama endpoint on the Oracle host (reached through the reverse SSH tunnel, bound to the host's loopback).
// FAIL CLOSED: it never starts, restarts or reroutes anything and never talks to any other AI service. When the endpoint is unreachable, changed or
// unexpected it raises an alert (same sink as the maintenance supervisor) and writes a status file; the A-Zee app itself already refuses AI requests
// when Ollama is unavailable (no fallback exists in ollama-only mode).
//   OLLAMA_BASE_URL=http://127.0.0.1:11434 OLLAMA_MODEL=qwen2.5:1.5b OLLAMA_MODEL_DIGEST=sha256:<hex> node scripts/staging/ollama-tunnel-health.mjs
//   TUNNEL_CHECK_INTERVAL_MS=30000  TUNNEL_STATUS_FILE=...  TUNNEL_ALERT_FILE=...  ALERT_COMMAND=...  ALERT_AFTER=2  ALERT_OWNER=...  ALERT_RUNBOOK=...
import { writeFileSync, renameSync, appendFileSync } from "node:fs";
import { spawn } from "node:child_process";

const LOOPBACK = new Set(["127.0.0.1", "[::1]"]);

/** One probe. Returns {ok:true, model} or {ok:false, reason}. Reasons are stable codes; no response body is ever returned. */
export async function checkOllama({ baseUrl, model, digest, timeoutMs = 4000, fetchImpl = fetch }) {
  let url; try { url = new URL(baseUrl); } catch { return { ok: false, reason: "invalid_endpoint" }; }
  if (url.protocol !== "http:" || url.username || url.password || url.search || url.hash) return { ok: false, reason: "invalid_endpoint" };
  if (!LOOPBACK.has(url.hostname)) return { ok: false, reason: "non_loopback_endpoint" };       // the tunnel must terminate on loopback; anything else is a misconfiguration
  if (!model || !digest) return { ok: false, reason: "model_or_digest_not_pinned" };
  let res;
  try { res = await fetchImpl(`${url.origin}/api/tags`, { signal: AbortSignal.timeout(timeoutMs), redirect: "error" }); } catch { return { ok: false, reason: "unreachable" }; }
  if (!res.ok) return { ok: false, reason: "unexpected_status" };
  let body; try { body = await res.json(); } catch { return { ok: false, reason: "invalid_response" }; }
  const m = body?.models?.find?.((x) => x?.name === model || x?.model === model);
  if (!m) return { ok: false, reason: "model_missing" };
  if (m.remote_host || m.remote_model || /(?:^|[-:])cloud(?:$|[-:])/i.test(model)) return { ok: false, reason: "remote_model" };   // a cloud alias would proxy prompts off-box
  if (m.digest !== digest) return { ok: false, reason: "digest_mismatch" };
  return { ok: true, model };
}

export function createMonitor({ check, now = () => Date.now(), alertAfter = 2, owner = "azee-staging-owner", runbook = "docs/oracle-staging-ai-topology.md", sink = () => {}, writeStatus = () => {} }) {
  const state = { checks: 0, consecutiveFailures: 0, lastOkAt: null, lastReason: null, alerting: false };
  async function tick() {
    state.checks++; const r = await check();
    if (r.ok) { state.consecutiveFailures = 0; state.lastOkAt = now(); state.lastReason = null; if (state.alerting) { state.alerting = false; sink({ at: new Date(now()).toISOString(), severity: "info", event: "ollama_endpoint_recovered", owner, runbook, detail: {} }); } }
    else {
      state.consecutiveFailures++; state.lastReason = r.reason;
      // a changed/foreign model is a security event: alert at once; plain unavailability alerts after `alertAfter` consecutive failures
      const urgent = ["digest_mismatch", "remote_model", "non_loopback_endpoint", "model_missing"].includes(r.reason);
      if (!state.alerting && (urgent || state.consecutiveFailures >= alertAfter)) { state.alerting = true; sink({ at: new Date(now()).toISOString(), severity: urgent ? "critical" : "major", event: "ollama_endpoint_unhealthy", owner, runbook, detail: { reason: r.reason, consecutiveFailures: state.consecutiveFailures } }); }
    }
    const snap = { at: new Date(now()).toISOString(), healthy: r.ok, aiAvailable: r.ok, ...state, secondsSinceOk: state.lastOkAt ? Math.round((now() - state.lastOkAt) / 1000) : null };
    writeStatus(snap); return snap;
  }
  return { tick, state };
}

if (process.argv[1]?.endsWith("ollama-tunnel-health.mjs")) {
  const env = process.env, atomic = (f, t) => { writeFileSync(`${f}.tmp`, t); renameSync(`${f}.tmp`, f); };
  const sink = (a) => {
    console.error(JSON.stringify({ type: "alert", ...a }));
    if (env.TUNNEL_ALERT_FILE) appendFileSync(env.TUNNEL_ALERT_FILE, JSON.stringify(a) + "\n");
    if (env.ALERT_COMMAND) { const p = spawn(env.ALERT_COMMAND, { shell: true, stdio: ["pipe", "ignore", "ignore"] }); p.on("error", () => console.error(JSON.stringify({ type: "alert_delivery_failed", event: a.event, why: "spawn" }))); p.on("close", (c) => { if (c !== 0) console.error(JSON.stringify({ type: "alert_delivery_failed", event: a.event, why: `exit ${c}` })); }); p.stdin.on("error", () => {}); p.stdin.end(JSON.stringify(a)); }
  };
  const mon = createMonitor({ check: () => checkOllama({ baseUrl: env.OLLAMA_BASE_URL || "http://127.0.0.1:11434", model: env.OLLAMA_MODEL, digest: env.OLLAMA_MODEL_DIGEST }),
    alertAfter: Number(env.ALERT_AFTER || 2), owner: env.ALERT_OWNER || "azee-staging-owner", runbook: env.ALERT_RUNBOOK || "docs/oracle-staging-ai-topology.md", sink,
    writeStatus: (s) => { console.log(JSON.stringify({ type: "ollama_health", ...s })); if (env.TUNNEL_STATUS_FILE) atomic(env.TUNNEL_STATUS_FILE, JSON.stringify(s, null, 1)); } });
  let stop = false; process.on("SIGTERM", () => { stop = true; }); process.on("SIGINT", () => { stop = true; });
  while (!stop) { await mon.tick(); await new Promise((r) => setTimeout(r, Number(env.TUNNEL_CHECK_INTERVAL_MS || 30_000))); }
}
