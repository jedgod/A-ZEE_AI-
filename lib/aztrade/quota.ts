import "server-only";
import { pool } from "@/lib/admin/db";
import { resolveTradeEntitlements } from "./entitlements";
import { lookupSubscription } from "./identity";

// AZTrade daily quotas (backtest runs, AI research questions), counted in A-Zee's PostgreSQL and kept separate from
// ordinary chat allowances. The limit is looked up from A-Zee's live subscription on EVERY call, so a downgrade applies
// at once (a user already over the lower limit is simply refused) and an upgrade applies at once too.
//
//   * Atomic: one INSERT ... ON CONFLICT DO UPDATE ... WHERE used < limit. Concurrent requests cannot overshoot.
//   * Idempotent: each request id is stored once. A retry of a request that is already reserved is not charged again.
//   * Refundable: a failed run gives its slot back exactly once (the event flips reserved -> refunded). Re-reserving a
//     refunded request id charges again, so a genuine retry after a failure works.
//   * Days are UTC calendar days.

export type QuotaFeature = "backtest" | "research";
export type Reservation = { allowed: boolean; used: number; limit: number; remaining: number; replay: boolean };

type Client = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }>; release: () => void };
export type QuotaDb = { connect: () => Promise<Client> };

export const utcDay = (now = new Date()) => now.toISOString().slice(0, 10);

/** The daily limit for this account's current plan. */
export async function dailyLimit(userId: string, feature: QuotaFeature): Promise<number> {
  const { tier } = await lookupSubscription(userId);
  const e = resolveTradeEntitlements(tier);
  return feature === "backtest" ? (e.backtesting ? e.maximumBacktestRunsPerDay : 0) : (e.aiAssistant ? e.maximumResearchPerDay : 0);
}

export async function reserveQuota(a: { userId: string; feature: QuotaFeature; requestId: string; limit: number; now?: Date }, db: QuotaDb = pool as unknown as QuotaDb): Promise<Reservation> {
  const { userId, feature, requestId, limit } = a;
  const day = utcDay(a.now);
  // limit 0 must never reach the upsert: its INSERT branch would create a row with used = 1.
  if (!(limit > 0)) return { allowed: false, used: 0, limit: Math.max(0, limit), remaining: 0, replay: false };
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    const claimed = await c.query(
      `INSERT INTO aztrade_quota_events (owner_id, feature, request_id, day, status) VALUES ($1, $2, $3, $4, 'reserved')
       ON CONFLICT (owner_id, feature, request_id) DO NOTHING RETURNING 1`, [userId, feature, requestId, day]);
    if (!claimed.rowCount) {
      const prior = (await c.query(`SELECT status, day FROM aztrade_quota_events WHERE owner_id = $1 AND feature = $2 AND request_id = $3 FOR UPDATE`, [userId, feature, requestId])).rows[0];
      if (prior?.status === "reserved") {                                   // a retry: already counted, do not charge again
        const used = (await c.query(`SELECT used FROM aztrade_daily_usage WHERE owner_id = $1 AND feature = $2 AND day = $3`, [userId, feature, prior.day])).rows[0]?.used ?? 0;
        await c.query("COMMIT");
        return { allowed: true, used, limit, remaining: Math.max(0, limit - used), replay: true };
      }
      await c.query(`UPDATE aztrade_quota_events SET status = 'reserved', day = $4, created_at = now() WHERE owner_id = $1 AND feature = $2 AND request_id = $3`, [userId, feature, requestId, day]);
    }
    const taken = await c.query(
      `INSERT INTO aztrade_daily_usage (owner_id, feature, day, used) VALUES ($1, $2, $3, 1)
       ON CONFLICT (owner_id, feature, day) DO UPDATE SET used = aztrade_daily_usage.used + 1
       WHERE aztrade_daily_usage.used < $4 RETURNING used`, [userId, feature, day, limit]);
    if (!taken.rowCount) {                                                   // exhausted: undo the event too
      await c.query("ROLLBACK");
      const used = (await c.query(`SELECT used FROM aztrade_daily_usage WHERE owner_id = $1 AND feature = $2 AND day = $3`, [userId, feature, day])).rows[0]?.used ?? limit;
      return { allowed: false, used, limit, remaining: 0, replay: false };
    }
    await c.query("COMMIT");
    const used = taken.rows[0].used as number;
    return { allowed: true, used, limit, remaining: Math.max(0, limit - used), replay: false };
  } catch (error) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { c.release(); }
}

/** Gives the slot back once. Refunding an unknown, already refunded or never reserved request does nothing. */
export async function refundQuota(a: { userId: string; feature: QuotaFeature; requestId: string }, db: QuotaDb = pool as unknown as QuotaDb): Promise<boolean> {
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    const row = (await c.query(
      `UPDATE aztrade_quota_events SET status = 'refunded' WHERE owner_id = $1 AND feature = $2 AND request_id = $3 AND status = 'reserved' RETURNING day`,
      [a.userId, a.feature, a.requestId])).rows[0];
    if (row) await c.query(`UPDATE aztrade_daily_usage SET used = GREATEST(used - 1, 0) WHERE owner_id = $1 AND feature = $2 AND day = $3`, [a.userId, a.feature, row.day]);
    await c.query("COMMIT");
    return Boolean(row);
  } catch (error) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { c.release(); }
}

/** Reads today's usage without changing it (for display). */
export async function quotaStatus(userId: string, feature: QuotaFeature, db: QuotaDb = pool as unknown as QuotaDb) {
  const limit = await dailyLimit(userId, feature);
  const c = await db.connect();
  try {
    const used = (await c.query(`SELECT used FROM aztrade_daily_usage WHERE owner_id = $1 AND feature = $2 AND day = $3`, [userId, feature, utcDay()])).rows[0]?.used ?? 0;
    return { used, limit, remaining: Math.max(0, limit - used) };
  } finally { c.release(); }
}
