#!/usr/bin/env node
// Supervised schedule for the inference maintenance worker (scripts/lib/inference-maintenance.cjs): recovers stale 'running' requests
// (refunding the quota exactly once), clears reply text after 7 days, deletes request metadata after 90 days.
//   DATABASE_URL=...  MAINTENANCE_INTERVAL_MS=60000  MAINTENANCE_METRICS_FILE=...  MAINTENANCE_ALERT_FILE=...  node scripts/staging/maintenance-supervisor.mjs
// What it adds over running the worker from a bare scheduler:
//   - a metrics snapshot after EVERY cycle (backlog of stale requests, recovered/redacted/deleted counts, last success, consecutive failures)
//   - an ALERT (owner + runbook attached) after ALERT_AFTER consecutive failures, immediately on a quota-reconciliation mismatch, and when the
//     worker has not succeeded for longer than STALE_AFTER_MS; plus a RECOVERED notice. Alerts go to a JSON-lines file and to the optional
//     ALERT_COMMAND (receives the JSON on stdin) - wire that to a real channel (pager/chat/email) when one is chosen; none is configured here.
//   - never logs prompts, replies, tokens or account ids.
import { createRequire } from "node:module";
import { appendFileSync, writeFileSync, renameSync } from "node:fs";
import { spawn } from "node:child_process";
import pg from "pg";

const require = createRequire(import.meta.url);

export function createSupervisor({ run, backlog, now = () => Date.now(), alertAfter = 3, staleAfterMs = 10 * 60_000, owner = "azee-staging-owner", runbook = "docs/runbooks/inference-maintenance.md", sink = () => {}, writeMetrics = () => {} }) {
  const state = { cycles: 0, failures: 0, consecutiveFailures: 0, lastSuccessAt: null, lastStats: null, alerting: false, staleAlerted: false };
  const raise = (severity, event, detail) => sink({ at: new Date(now()).toISOString(), severity, event, owner, runbook, detail });
  async function cycle() {
    state.cycles++;
    try {
      const stats = await run();
      state.lastStats = stats; state.lastSuccessAt = now(); state.consecutiveFailures = 0; state.staleAlerted = false;
      if (state.alerting) { state.alerting = false; raise("info", "maintenance_recovered", {}); }
    } catch (e) {
      state.failures++; state.consecutiveFailures++;
      const mismatch = /reconciliation mismatch/i.test(e.message);              // quota books disagree: needs a human, alert at once
      if ((mismatch || state.consecutiveFailures >= alertAfter) && !(state.alerting && !mismatch)) { state.alerting = true; raise(mismatch ? "critical" : "major", mismatch ? "quota_reconciliation_mismatch" : "maintenance_failing", { consecutiveFailures: state.consecutiveFailures, message: String(e.message).slice(0, 200) }); }
    }
    const age = state.lastSuccessAt ? now() - state.lastSuccessAt : null;
    if (age !== null && age > staleAfterMs && !state.staleAlerted) { state.staleAlerted = true; state.alerting = true; raise("major", "maintenance_stale", { secondsSinceSuccess: Math.round(age / 1000) }); }
    let pending = null; try { pending = await backlog(); } catch { /* the metric is best-effort */ }
    const snapshot = { at: new Date(now()).toISOString(), ...state, staleRunning: pending, secondsSinceSuccess: age === null ? null : Math.round(age / 1000) };
    writeMetrics(snapshot); return snapshot;
  }
  return { cycle, state };
}

if (process.argv[1]?.endsWith("maintenance-supervisor.mjs")) {
  const { maintain } = require("../lib/inference-maintenance.cjs");
  const env = process.env; if (!env.DATABASE_URL) { console.error("DATABASE_URL required"); process.exit(2); }
  const interval = Number(env.MAINTENANCE_INTERVAL_MS || 60_000);
  const atomic = (f, t) => { writeFileSync(`${f}.tmp`, t); renameSync(`${f}.tmp`, f); };
  const sink = (a) => {
    console.error(JSON.stringify({ type: "alert", ...a }));
    if (env.MAINTENANCE_ALERT_FILE) appendFileSync(env.MAINTENANCE_ALERT_FILE, JSON.stringify(a) + "\n");
    if (env.ALERT_COMMAND) {   // delivery is NOT assumed: a failing or unconfigured command is itself reported, never silent
      const failed = (why) => console.error(JSON.stringify({ type: "alert_delivery_failed", event: a.event, why }));
      const p = spawn(env.ALERT_COMMAND, { shell: true, stdio: ["pipe", "ignore", "ignore"] }); p.on("error", () => failed("spawn")); p.on("close", (code) => { if (code !== 0) failed(`exit ${code}`); }); p.stdin.on("error", () => {}); p.stdin.end(JSON.stringify(a));
    }
  };
  const withDb = async (fn) => { const db = new pg.Client({ connectionString: env.DATABASE_URL, statement_timeout: 30000, connectionTimeoutMillis: 5000 }); db.on("error", () => {}); await db.connect(); try { return await fn(db); } finally { await db.end().catch(() => {}); } };
  const sup = createSupervisor({
    run: () => withDb((db) => maintain(db)),
    backlog: () => withDb(async (db) => { let n = 0; for (const t of ["linqext_requests", "aztrade_ai_requests"]) n += (await db.query(`SELECT count(*)::int c FROM ${t} WHERE status='running' AND created_at < now() - interval '5 minutes'`)).rows[0].c; return n; }),
    alertAfter: Number(env.ALERT_AFTER || 3), staleAfterMs: Number(env.STALE_AFTER_MS || 10 * 60_000), owner: env.ALERT_OWNER || "azee-staging-owner", runbook: env.ALERT_RUNBOOK || "docs/runbooks/inference-maintenance.md", sink,
    writeMetrics: (m) => { console.log(JSON.stringify({ type: "maintenance_cycle", ...m })); if (env.MAINTENANCE_METRICS_FILE) atomic(env.MAINTENANCE_METRICS_FILE, JSON.stringify(m, null, 1)); },
  });
  let stop = false; process.on("SIGTERM", () => { stop = true; }); process.on("SIGINT", () => { stop = true; });
  while (!stop) { await sup.cycle(); await new Promise((r) => setTimeout(r, interval)); }
}
