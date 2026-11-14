import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin/db", () => ({ pool: {} }));

import { createRule, deleteRule, listRules, MonitorError, saveDeviceToken, setRuleStatus, updateRule, validateRule } from "@/lib/finance/monitor";
import { evaluateRule, parseChange, runMonitorCycle, sendExpoPush, type WorkerDeps } from "@/lib/finance/monitor-worker";
import type { BatchItem, BatchResult } from "@/lib/finance/batch";

// The SQL runs on a REAL PostgreSQL. It needs a throwaway server: set AZTRADE_QUOTA_TEST_ADMIN_URL to a superuser URL for a
// disposable local instance. Without it the database tests are skipped, not passed.
const ADMIN = process.env.AZTRADE_QUOTA_TEST_ADMIN_URL;
const suite = ADMIN ? describe : describe.skip;
const DB = "aztrade_monitor_test";
const code = async (p: Promise<unknown>) => p.then(() => "none", (e: MonitorError) => `${e.status}:${e.code}`);

describe("rule validation and the pure evaluator", () => {
  const rule = (rule_type: any, threshold: string, asset_class: any = "crypto") => ({ id: "r", user_id: "u", symbol: "BTC", asset_class, rule_type, threshold });
  it("rejects what could never work or could be abusive", () => {
    expect(() => validateRule({ symbol: "BTC&x=1", assetClass: "crypto", ruleType: "price_below", threshold: 1 })).toThrow("INVALID_SYMBOL");
    expect(() => validateRule({ symbol: "BTC", assetClass: "crypto", ruleType: "price_below", threshold: 0 })).toThrow("INVALID_THRESHOLD");
    expect(() => validateRule({ symbol: "BTC", assetClass: "crypto", ruleType: "price_below", threshold: NaN })).toThrow("INVALID_THRESHOLD");
    expect(() => validateRule({ symbol: "EUR/USD", assetClass: "forex", ruleType: "pct_drop_24h", threshold: 3 })).toThrow("PERCENT_NOT_SUPPORTED");
    expect(() => validateRule({ symbol: "GOLD", assetClass: "commodities", ruleType: "pct_rise_24h", threshold: 3 })).toThrow("PERCENT_NOT_SUPPORTED");
    expect(() => validateRule({ symbol: "BTC", assetClass: "crypto", ruleType: "pct_drop_24h", threshold: 150 })).toThrow("INVALID_THRESHOLD");
    expect(validateRule({ symbol: " btc ", assetClass: "crypto", ruleType: "pct_drop_24h", threshold: 3 }).symbol).toBe("BTC");
  });
  it("evaluates each rule type on the right side of its threshold", () => {
    expect(evaluateRule(rule("pct_drop_24h", "3"), 100, -3.2).triggered).toBe(true);
    expect(evaluateRule(rule("pct_drop_24h", "3"), 100, -2.9).triggered).toBe(false);
    expect(evaluateRule(rule("pct_drop_24h", "3"), 100, 5).triggered).toBe(false);
    expect(evaluateRule(rule("pct_rise_24h", "3"), 100, 3).triggered).toBe(true);
    expect(evaluateRule(rule("pct_rise_24h", "3"), 100, null).triggered).toBe(false);
    expect(evaluateRule(rule("price_below", "50000"), 49999, null).triggered).toBe(true);
    expect(evaluateRule(rule("price_below", "50000"), 50001, null).triggered).toBe(false);
    expect(evaluateRule(rule("price_above", "70000"), 70000, null).triggered).toBe(true);
    expect(evaluateRule(rule("price_above", "70000"), 69999, null).summary).toBe("");
    expect(parseChange("-1.50%")).toBe(-1.5);
    expect(parseChange("+0.76%")).toBe(0.76);
    expect(parseChange("n/a")).toBeNull();
    expect(parseChange(undefined)).toBeNull();
  });
});

suite("monitoring on PostgreSQL", () => {
  let pool: pg.Pool;
  const count = async (sql: string, v: unknown[] = []) => (await pool.query(sql, v)).rows[0].n as number;
  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: ADMIN });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${DB}`);
    await admin.end();
    const url = new URL(ADMIN!); url.pathname = `/${DB}`;
    pool = new pg.Pool({ connectionString: url.toString(), max: 20 });
    await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
    await pool.query(`CREATE TABLE users (id TEXT PRIMARY KEY)`);
    await pool.query(`CREATE TABLE notifications (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, title TEXT NOT NULL, body TEXT, read_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await pool.query(readFileSync("migrations/043_monitoring.sql", "utf8"));
    await pool.query(readFileSync("migrations/043_monitoring.sql", "utf8"));   // idempotent: a second run changes nothing
    await pool.query(readFileSync("migrations/044_monitor_recurrence.sql", "utf8"));
    await pool.query(readFileSync("migrations/044_monitor_recurrence.sql", "utf8"));
  });
  afterAll(async () => { await pool?.end(); });
  beforeEach(async () => {
    await pool.query(`TRUNCATE users CASCADE`);
    await pool.query(`INSERT INTO users VALUES ('u1'), ('u2')`);
  });

  const rule = (userId: string, o: Partial<{ symbol: string; assetClass: any; ruleType: any; threshold: number; recurrence: any }> = {}) =>
    createRule(userId, { symbol: "BTC", assetClass: "crypto", ruleType: "price_below", threshold: 50000, ...o }, pool as never);

  // A scripted quote feed and a fixed clock.
  let feed: (items: BatchItem[]) => BatchResult[];
  let clock = new Date("2026-11-13T12:00:00Z");
  const push = vi.fn(async () => true);
  const quote = (price: number, extra: Record<string, unknown> = {}) => ({ symbol: "BTC", assetClass: "crypto", price, currency: "USD", provider: "coingecko", notice: "n", ...extra });
  const deps = (over: Partial<WorkerDeps> = {}): WorkerDeps => ({ db: pool as never, quotes: async items => feed(items), push, now: () => clock, privateMode: () => false, ...over });
  const good = (price: number, extra: Record<string, unknown> = {}) => (items: BatchItem[]): BatchResult[] => items.map(i => ({ ...i, quote: quote(price, { symbol: i.symbol, ...extra }) as never }));
  beforeEach(() => { clock = new Date("2026-11-13T12:00:00Z"); push.mockClear(); push.mockResolvedValue(true); feed = good(65000); });

  it("creates, lists, pauses and deletes rules, and only ever for their owner", async () => {
    const r = await rule("u1");
    expect(r).toMatchObject({ symbol: "BTC", status: "active" });
    expect((await listRules("u1", pool as never)).rules).toHaveLength(1);
    expect((await listRules("u2", pool as never)).rules).toHaveLength(0);
    expect(await code(setRuleStatus("u2", r.id, "paused", pool as never))).toBe("404:NOT_FOUND");
    expect(await code(deleteRule("u2", r.id, pool as never))).toBe("404:NOT_FOUND");
    expect((await setRuleStatus("u1", r.id, "paused", pool as never)).status).toBe("paused");
    await deleteRule("u1", r.id, pool as never);
    expect((await listRules("u1", pool as never)).rules).toHaveLength(0);
  });

  it("never lets an account hold more than 15 rules, even when many are created at once", async () => {
    const out = await Promise.all(Array.from({ length: 25 }, (_, i) => code(rule("u1", { threshold: 40000 + i }))));
    expect(out.filter(x => x === "none")).toHaveLength(15);
    expect(out.filter(x => x === "429:RULE_LIMIT_REACHED")).toHaveLength(10);
    expect(await count(`SELECT count(*)::int AS n FROM monitor_rules WHERE user_id = 'u1'`)).toBe(15);
    expect(await code(rule("u2"))).toBe("none");   // another account is unaffected
  });

  it("the database itself refuses bad rows", async () => {
    await expect(pool.query(`INSERT INTO monitor_rules (user_id, symbol, asset_class, rule_type, threshold) VALUES ('u1', 'btc', 'crypto', 'price_below', 1)`)).rejects.toThrow();
    await expect(pool.query(`INSERT INTO monitor_rules (user_id, symbol, asset_class, rule_type, threshold) VALUES ('u1', 'BTC', 'futures', 'price_below', 1)`)).rejects.toThrow();
    await expect(pool.query(`INSERT INTO monitor_rules (user_id, symbol, asset_class, rule_type, threshold) VALUES ('u1', 'BTC', 'crypto', 'price_below', -1)`)).rejects.toThrow();
  });

  it("alerts once: an in-app notification, an audit row, the rule marked triggered, and a push attempt", async () => {
    const r = await rule("u1", { threshold: 70000 });   // 65000 is below 70000
    const out = await runMonitorCycle(deps());
    expect(out).toMatchObject({ skipped: false, evaluated: 1, triggered: 1, stale: 0 });
    expect(await count(`SELECT count(*)::int AS n FROM alert_events WHERE rule_id = $1`, [r.id])).toBe(1);
    const n = (await pool.query(`SELECT title, body FROM notifications WHERE user_id = 'u1'`)).rows;
    expect(n).toHaveLength(1);
    expect(n[0].title).toBe("AZTrade alert: BTC");
    expect(n[0].body).toMatch(/at or below your \$70,000\.00 rule.*coingecko \(delayed\).*not advice/);
    expect((await pool.query(`SELECT status, last_price::float AS p, last_source FROM monitor_rules WHERE id = $1`, [r.id])).rows[0]).toEqual({ status: "triggered", p: 65000, last_source: "coingecko (delayed)" });
    expect(push).toHaveBeenCalledTimes(1);
    expect(await count(`SELECT count(*)::int AS n FROM alert_events WHERE push_sent`)).toBe(1);
    expect((await runMonitorCycle(deps())).evaluated).toBe(0);   // a triggered rule is not re-checked
  });

  it("never alerts the same rule twice in one UTC day, even if it is re-armed; it can alert again the next day", async () => {
    const r = await rule("u1", { threshold: 70000 });
    await runMonitorCycle(deps());
    await setRuleStatus("u1", r.id, "active", pool as never);
    const again = await runMonitorCycle(deps());
    expect(again.triggered).toBe(0);
    expect(await count(`SELECT count(*)::int AS n FROM notifications`)).toBe(1);
    expect((await pool.query(`SELECT status FROM monitor_rules WHERE id = $1`, [r.id])).rows[0].status).toBe("active");
    clock = new Date("2026-11-14T00:05:00Z");
    expect((await runMonitorCycle(deps())).triggered).toBe(1);
    expect(await count(`SELECT count(*)::int AS n FROM alert_events`)).toBe(2);
  });

  it("two cycles at once produce one alert (restarts and duplicate workers are harmless)", async () => {
    await rule("u1", { threshold: 70000 });
    const [a, b] = await Promise.all([runMonitorCycle(deps()), runMonitorCycle(deps())]);
    expect(a.triggered + b.triggered).toBe(1);
    expect(await count(`SELECT count(*)::int AS n FROM alert_events`)).toBe(1);
  });

  it("skips a cycle while another worker holds the lock", async () => {
    const holder = await pool.connect();
    try {
      await holder.query(`SELECT pg_advisory_lock(4815162342)`);
      expect(await runMonitorCycle(deps())).toEqual({ skipped: true, evaluated: 0, triggered: 0, stale: 0 });
    } finally { await holder.query(`SELECT pg_advisory_unlock(4815162342)`); holder.release(); }
  });

  it("does not fire on bad data: it marks the rule stale with the reason, and recovers on a good quote", async () => {
    const r = await rule("u1", { threshold: 70000 });
    feed = items => items.map(i => ({ ...i, error: "PROVIDER_NOT_CONFIGURED" }));
    expect(await runMonitorCycle(deps())).toMatchObject({ triggered: 0, stale: 1 });
    expect((await pool.query(`SELECT status, stale_reason FROM monitor_rules WHERE id = $1`, [r.id])).rows[0]).toMatchObject({ status: "stale_feed", stale_reason: expect.stringContaining("No data source") });
    feed = good(0);
    expect((await runMonitorCycle(deps())).stale).toBe(1);   // a zero price is not a price
    feed = good(Number.NaN);
    expect((await runMonitorCycle(deps())).stale).toBe(1);
    expect(await count(`SELECT count(*)::int AS n FROM alert_events`)).toBe(0);
    feed = good(80000);   // healthy and not below the rule
    expect(await runMonitorCycle(deps())).toMatchObject({ triggered: 0, stale: 0 });
    expect((await pool.query(`SELECT status, stale_reason FROM monitor_rules WHERE id = $1`, [r.id])).rows[0]).toEqual({ status: "active", stale_reason: null });
  });

  it("treats an old quote, or a missing 24-hour change on a percent rule, as stale", async () => {
    const a = await rule("u1", { threshold: 70000 });
    feed = good(65000, { asOf: "2026-11-01" });
    await runMonitorCycle(deps());
    expect((await pool.query(`SELECT stale_reason FROM monitor_rules WHERE id = $1`, [a.id])).rows[0].stale_reason).toMatch(/more than 5 days old/);
    await pool.query(`DELETE FROM monitor_rules`);
    const b = await rule("u1", { ruleType: "pct_drop_24h", threshold: 3 });
    feed = good(65000);   // no changePercent in the quote
    await runMonitorCycle(deps());
    expect((await pool.query(`SELECT status, stale_reason FROM monitor_rules WHERE id = $1`, [b.id])).rows[0]).toMatchObject({ status: "stale_feed", stale_reason: expect.stringContaining("24-hour change") });
    feed = good(65000, { changePercent: "-3.40%" });
    expect(await runMonitorCycle(deps())).toMatchObject({ triggered: 1 });
  });

  it("makes no market call in private mode and says why on each rule", async () => {
    const quotes = vi.fn(async () => []);
    await rule("u1"); await rule("u2");
    const out = await runMonitorCycle(deps({ privateMode: () => true, quotes }));
    expect(out).toMatchObject({ evaluated: 0, stale: 2 });
    expect(quotes).not.toHaveBeenCalled();
    expect((await pool.query(`SELECT DISTINCT stale_reason FROM monitor_rules`)).rows[0].stale_reason).toMatch(/private mode/);
  });

  it("looks each symbol up once however many rules use it", async () => {
    await rule("u1", { threshold: 70000 }); await rule("u2", { threshold: 70000 }); await rule("u1", { threshold: 71000 });
    const quotes = vi.fn(async (items: BatchItem[]) => good(65000)(items));
    await runMonitorCycle(deps({ quotes }));
    expect(quotes).toHaveBeenCalledTimes(1);
    expect((quotes.mock.calls[0][0] as BatchItem[])).toHaveLength(1);
  });

  it("keeps the alert and the notification if the push fails", async () => {
    await rule("u1", { threshold: 70000 });
    push.mockRejectedValueOnce(new Error("expo down"));
    expect((await runMonitorCycle(deps())).triggered).toBe(1);
    expect(await count(`SELECT count(*)::int AS n FROM notifications`)).toBe(1);
    expect(await count(`SELECT count(*)::int AS n FROM alert_events WHERE push_sent`)).toBe(0);
  });

  it("stores a device token once, moves it to the new account, and sends pushes with dead tokens removed", async () => {
    const tok = "ExponentPushToken[abcdefghijklmnopqrstuv]";
    await saveDeviceToken("u1", tok, "android", pool as never);
    await saveDeviceToken("u2", tok, "android", pool as never);
    expect((await pool.query(`SELECT user_id FROM user_push_tokens`)).rows).toEqual([{ user_id: "u2" }]);
    expect(await code(saveDeviceToken("u1", "not-a-token", "android", pool as never))).toBe("400:INVALID_TOKEN");
    const fetchMock = vi.fn(async (_url: string, init: any) => { expect(JSON.parse(init.body)[0].to).toBe(tok); return new Response(JSON.stringify({ data: [{ status: "error", details: { error: "DeviceNotRegistered" } }] }), { status: 200 }); });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const c = await pool.connect();
      expect(await sendExpoPush(c as never, "u2", "t", "b", "r")).toBe(false);
      c.release();
    } finally { vi.unstubAllGlobals(); }
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://exp.host/--/api/v2/push/send");
    expect(await count(`SELECT count(*)::int AS n FROM user_push_tokens`)).toBe(0);
  });

  const at = (min: number) => { clock = new Date(Date.parse("2026-11-13T12:00:00Z") + min * 60_000); };
  const alerts = async () => count(`SELECT count(*)::int AS n FROM alert_events`);

  it("defaults to once, and stores 'each crossing' when asked", async () => {
    expect((await rule("u1")).recurrence).toBe("once");
    expect((await rule("u1", { recurrence: "each_crossing" })).recurrence).toBe("each_crossing");
    await expect(rule("u1", { recurrence: "weekly" })).rejects.toThrow("INVALID_REQUEST");
  });

  it("each crossing: the first check is only a baseline, then it alerts on every step from not-met to met, never while it stays beyond the level", async () => {
    const r = await rule("u1", { threshold: 70000, recurrence: "each_crossing" });   // met whenever price <= 70,000
    const step = async (price: number, min: number) => { feed = good(price); at(min); return runMonitorCycle(deps()); };
    expect((await step(65000, 0)).triggered).toBe(0);    // already met at the first check: baseline only
    expect((await step(66000, 2)).triggered).toBe(0);    // still met
    expect((await step(72000, 4)).triggered).toBe(0);    // not met
    expect((await step(65000, 6)).triggered).toBe(1);    // crossed: alert 1
    expect((await step(64000, 8)).triggered).toBe(0);    // stays beyond the level
    expect((await step(73000, 10)).triggered).toBe(0);
    expect((await step(69000, 12)).triggered).toBe(1);   // crossed again: alert 2
    expect(await alerts()).toBe(2);
    expect(await count(`SELECT count(*)::int AS n FROM notifications`)).toBe(2);
    expect((await pool.query(`SELECT status, condition_met FROM monitor_rules WHERE id = $1`, [r.id])).rows[0]).toEqual({ status: "active", condition_met: true });   // it keeps watching
  });

  it("each crossing: a price flapping around the level cannot flood the bell (5 alerts a day at most)", async () => {
    await rule("u1", { threshold: 70000, recurrence: "each_crossing" });
    let min = 0;
    for (let i = 0; i < 10; i++) { feed = good(i % 2 ? 65000 : 75000); at(min += 2); await runMonitorCycle(deps()); }
    feed = good(75000); at(min += 2); await runMonitorCycle(deps());
    for (let i = 0; i < 8; i++) { feed = good(i % 2 ? 75000 : 65000); at(min += 2); await runMonitorCycle(deps()); }
    expect(await alerts()).toBe(5);
  });

  it("'once' still alerts as soon as the condition is met, then waits to be re-armed", async () => {
    const r = await rule("u1", { threshold: 70000 });
    expect((await runMonitorCycle(deps())).triggered).toBe(1);
    expect((await pool.query(`SELECT status FROM monitor_rules WHERE id = $1`, [r.id])).rows[0].status).toBe("triggered");
  });

  it("each alert keeps a snapshot of the rule and the quote, so it can be explained later", async () => {
    const r = await rule("u1", { threshold: 70000 });
    feed = good(65000, { asOf: "2026-11-13T11:58:00Z", changePercent: "-1.25%" });
    await runMonitorCycle(deps());
    await pool.query(`UPDATE monitor_rules SET threshold = 1 WHERE id = $1`, [r.id]);   // editing the rule later must not rewrite history
    const a = (await listRules("u1", pool as never)).alerts[0];
    expect(a).toMatchObject({ rule_type: "price_below", recurrence: "once", symbol: "BTC", source: "coingecko (delayed)" });
    expect(Number(a.threshold)).toBe(70000);
    expect(Number(a.observed_price)).toBe(65000);
    expect(Number(a.change_pct)).toBe(-1.25);
    expect(new Date(a.quote_as_of).toISOString()).toBe("2026-11-13T11:58:00.000Z");
    const rr = (await listRules("u1", pool as never)).rules[0];
    expect(new Date(rr.last_quote_as_of).toISOString()).toBe("2026-11-13T11:58:00.000Z");
  });

  it("editing a rule re-arms it from scratch, is validated, and only works for its owner", async () => {
    const r = await rule("u1", { threshold: 70000, ruleType: "price_below" });
    await runMonitorCycle(deps());   // triggers
    const edited = await updateRule("u1", r.id, { ruleType: "price_above", threshold: 90000, recurrence: "each_crossing" }, pool as never);
    expect(edited).toMatchObject({ rule_type: "price_above", recurrence: "each_crossing", status: "active", triggered_at: null });
    expect(Number(edited.threshold)).toBe(90000);
    expect((await pool.query(`SELECT condition_met FROM monitor_rules WHERE id = $1`, [r.id])).rows[0].condition_met).toBeNull();
    expect(await code(updateRule("u2", r.id, { threshold: 5 }, pool as never))).toBe("404:NOT_FOUND");
    expect(await code(updateRule("u1", r.id, { threshold: -1 }, pool as never))).toBe("400:INVALID_THRESHOLD");
    const fx = await rule("u1", { symbol: "EUR/USD", assetClass: "forex", ruleType: "price_below", threshold: 1 });
    expect(await code(updateRule("u1", fx.id, { ruleType: "pct_drop_24h" }, pool as never))).toBe("400:PERCENT_NOT_SUPPORTED");
  });
});
