import { readFileSync } from "node:fs";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin/db", () => ({ pool: {} }));
let tier: "free" | "plus" | "premium" = "plus";
vi.mock("@/lib/aztrade/identity", () => ({ lookupSubscription: async () => ({ plan: tier, status: "active", tier }) }));

import { dailyLimit, refundQuota, reserveQuota, utcDay } from "@/lib/aztrade/quota";

// These exercise the REAL SQL on a real PostgreSQL. They need a throwaway server: set AZTRADE_QUOTA_TEST_ADMIN_URL to a
// superuser URL for a disposable local instance (never a shared database). Without it they are skipped, not passed.
const ADMIN = process.env.AZTRADE_QUOTA_TEST_ADMIN_URL;
const suite = ADMIN ? describe : describe.skip;
const DB = "aztrade_quota_test";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

suite("daily quota on PostgreSQL", () => {
  let pool: pg.Pool;
  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: ADMIN });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${DB}`);
    await admin.end();
    const url = new URL(ADMIN!); url.pathname = `/${DB}`;
    pool = new pg.Pool({ connectionString: url.toString(), max: 30 });
    await pool.query(`CREATE TABLE users (id TEXT PRIMARY KEY)`);
    await pool.query(`INSERT INTO users VALUES ('u1'), ('u2')`);
    await pool.query(readFileSync("migrations/042_aztrade_daily_quota.sql", "utf8"));
  });
  afterAll(async () => { await pool?.end(); });

  const slot = (userId: string, n: number, feature: "backtest" | "research" = "backtest", limit = 5, now?: Date) =>
    reserveQuota({ userId, feature, requestId: uuid(n), limit, now }, pool as never);
  const used = async (userId: string, feature = "backtest") => (await pool.query(`SELECT used FROM aztrade_daily_usage WHERE owner_id = $1 AND feature = $2 AND day = $3`, [userId, feature, utcDay()])).rows[0]?.used ?? 0;

  it("never exceeds the limit when many requests arrive at once", async () => {
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) => slot("u1", 100 + i, "backtest", 5)));
    expect(results.filter(r => r.allowed)).toHaveLength(5);
    expect(await used("u1")).toBe(5);
  });

  it("a retry of the same request id is not charged twice", async () => {
    const first = await slot("u2", 200, "research", 3);
    const again = await Promise.all([slot("u2", 200, "research", 3), slot("u2", 200, "research", 3), slot("u2", 200, "research", 3)]);
    expect(first).toMatchObject({ allowed: true, replay: false, used: 1 });
    expect(again.every(r => r.allowed && r.replay)).toBe(true);
    expect(await used("u2", "research")).toBe(1);
  });

  it("a refund gives the slot back exactly once, and a retry after a failure is charged again", async () => {
    await slot("u2", 300, "backtest", 5);
    const before = await used("u2");
    const refunds = await Promise.all([1, 2, 3].map(() => refundQuota({ userId: "u2", feature: "backtest", requestId: uuid(300) }, pool as never)));
    expect(refunds.filter(Boolean)).toHaveLength(1);
    expect(await used("u2")).toBe(before - 1);
    expect(await refundQuota({ userId: "u2", feature: "backtest", requestId: uuid(999) }, pool as never)).toBe(false);   // unknown request
    const retry = await slot("u2", 300, "backtest", 5);
    expect(retry).toMatchObject({ allowed: true, replay: false });
    expect(await used("u2")).toBe(before);
  });

  it("an exhausted quota refuses and leaves no reservation behind", async () => {
    const refused = await slot("u1", 400, "backtest", 5);
    expect(refused).toMatchObject({ allowed: false, remaining: 0 });
    expect((await pool.query(`SELECT 1 FROM aztrade_quota_events WHERE request_id = $1`, [uuid(400)])).rowCount).toBe(0);
    expect(await used("u1")).toBe(5);
  });

  it("a downgrade applies immediately: the lower limit refuses a user already over it, and zero never creates a row", async () => {
    expect(await slot("u1", 500, "backtest", 2)).toMatchObject({ allowed: false });      // already used 5, new limit 2
    const none = await slot("u1", 501, "research", 0);
    expect(none.allowed).toBe(false);
    expect(await used("u1", "research")).toBe(0);
  });

  it("each UTC day starts fresh, and features and users are counted separately", async () => {
    const tomorrow = new Date(Date.now() + 86_400_000);
    expect(await slot("u1", 600, "backtest", 5, tomorrow)).toMatchObject({ allowed: true, used: 1 });
    expect(await slot("u1", 601, "research", 5)).toMatchObject({ allowed: true, used: 1 });
  });
});

describe("daily limits follow the live plan", () => {
  it("Free gets no backtests, Plus and Premium get their own runs, and research has a cap on every plan", async () => {
    tier = "free"; expect(await dailyLimit("x", "backtest")).toBe(0); expect(await dailyLimit("x", "research")).toBe(5);
    tier = "plus"; expect(await dailyLimit("x", "backtest")).toBe(10); expect(await dailyLimit("x", "research")).toBe(25);
    tier = "premium"; expect(await dailyLimit("x", "backtest")).toBe(50); expect(await dailyLimit("x", "research")).toBe(100);
  });
  it("a downgrade is picked up on the very next call", async () => {
    tier = "premium"; const high = await dailyLimit("x", "backtest");
    tier = "plus"; const low = await dailyLimit("x", "backtest");
    expect(low).toBeLessThan(high);
  });
});
