import { timingSafeEqual } from "node:crypto";
import { runMonitorCycle } from "@/lib/finance/monitor-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

const sameSecret = (given: string, expected: string) => {
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

/** Called by a scheduler (scripts/monitor-tick.cjs, cron, a sidecar), never by an app. Needs MONITOR_WORKER_SECRET in x-worker-secret. */
export async function POST(request: Request) {
  const expected = process.env.MONITOR_WORKER_SECRET;
  if (!expected || expected.length < 24) return Response.json({ error: "NOT_CONFIGURED" }, { status: 503, headers });
  if (!sameSecret(request.headers.get("x-worker-secret") ?? "", expected)) return Response.json({ error: "UNAUTHORIZED" }, { status: 401, headers });
  try { return Response.json({ ok: true, ...(await runMonitorCycle()) }, { headers }); }
  catch (e) { console.error("monitor cycle failed:", e instanceof Error ? e.message : "error"); return Response.json({ error: "CYCLE_FAILED" }, { status: 500, headers }); }
}
