import { describe, it, expect } from "vitest";
import { createSupervisor } from "../scripts/staging/maintenance-supervisor.mjs";

const make = (run: () => Promise<any>, over: Record<string, unknown> = {}) => {
  let t = 1_000_000; const alerts: any[] = []; const metrics: any[] = [];
  const sup = createSupervisor({ run, backlog: async () => 2, now: () => t, sink: (a) => alerts.push(a), writeMetrics: (m) => metrics.push(m), alertAfter: 3, staleAfterMs: 5 * 60_000, owner: "owner-x", runbook: "rb.md", ...over });
  return { sup, alerts, metrics, advance: (ms: number) => { t += ms; } };
};

describe("maintenance supervisor", () => {
  it("records metrics every cycle, including the backlog and what was recovered", async () => {
    const { sup, metrics } = make(async () => ({ recovered: 2, redacted: 0, deleted: 0 }));
    const m = await sup.cycle();
    expect(m).toMatchObject({ cycles: 1, consecutiveFailures: 0, staleRunning: 2, lastStats: { recovered: 2 }, secondsSinceSuccess: 0 }); expect(metrics).toHaveLength(1);
  });
  it("does not alert on a single transient failure, alerts once after repeated failures (owner + runbook attached), then reports recovery", async () => {
    let fail = true; const { sup, alerts } = make(async () => { if (fail) throw new Error("connect ECONNREFUSED"); return { recovered: 0, redacted: 0, deleted: 0 }; });
    await sup.cycle(); await sup.cycle(); expect(alerts).toHaveLength(0);
    await sup.cycle(); expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ severity: "major", event: "maintenance_failing", owner: "owner-x", runbook: "rb.md", detail: { consecutiveFailures: 3 } });
    await sup.cycle(); await sup.cycle(); expect(alerts).toHaveLength(1);              // no alert storm while it stays broken
    fail = false; await sup.cycle();
    expect(alerts.map((a) => a.event)).toEqual(["maintenance_failing", "maintenance_recovered"]);
  });
  it("alerts immediately and critically on a quota reconciliation mismatch", async () => {
    const { sup, alerts } = make(async () => { throw new Error("Quota reconciliation mismatch; operator investigation required"); });
    await sup.cycle(); expect(alerts).toHaveLength(1); expect(alerts[0]).toMatchObject({ severity: "critical", event: "quota_reconciliation_mismatch" });
  });
  it("alerts when the worker has not succeeded for too long, even if it never throws a new failure", async () => {
    let ok = true; const { sup, alerts, advance } = make(async () => { if (!ok) throw new Error("db down"); return {}; });
    await sup.cycle(); ok = false; advance(6 * 60_000); await sup.cycle();
    expect(alerts.map((a) => a.event)).toContain("maintenance_stale");
  });
  it("never puts message text, tokens or account ids into an alert", async () => {
    const { sup, alerts } = make(async () => { throw new Error("Bearer secret-token postgres://user:password@host " + "x".repeat(500)); }); for (let i = 0; i < 3; i++) await sup.cycle();
    expect(JSON.stringify(alerts)).not.toMatch(/secret-token|password@host/); expect(JSON.stringify(alerts).length).toBeLessThan(900); expect(alerts[0].detail.message.length).toBeLessThanOrEqual(200);
  });
});
