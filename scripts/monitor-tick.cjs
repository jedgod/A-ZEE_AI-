// Runs the "Monitor this for me" evaluator on a schedule by calling the server's tick route.
//   node scripts/monitor-tick.cjs            every 2 minutes, until stopped
//   node scripts/monitor-tick.cjs --once     one cycle, then exit
// Needs the web server running and MONITOR_WORKER_SECRET in .env.local (or the environment).
const fs = require("node:fs");
const path = require("node:path");
for (const f of [".env.local", ".env"]) {
  try { for (const line of fs.readFileSync(path.join(__dirname, "..", f), "utf8").split(/\r?\n/)) { const m = /^([A-Z0-9_]+)=(.*)$/.exec(line); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, ""); } } catch { /* optional */ }
}
const base = process.env.MONITOR_TICK_URL || "http://127.0.0.1:3001";
const secret = process.env.MONITOR_WORKER_SECRET;
if (!secret) { console.error("MONITOR_WORKER_SECRET is not set."); process.exit(1); }
async function tick() {
  try {
    const res = await fetch(`${base}/api/internal/monitor-tick`, { method: "POST", headers: { "x-worker-secret": secret }, signal: AbortSignal.timeout(110000) });
    console.log(new Date().toISOString(), res.status, JSON.stringify(await res.json().catch(() => ({}))));
  } catch (e) { console.log(new Date().toISOString(), "tick failed:", e.name); }
}
if (process.argv.includes("--once")) tick().then(() => process.exit(0));
else { tick(); setInterval(tick, 120000); }
