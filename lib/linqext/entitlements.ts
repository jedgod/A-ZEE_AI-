import "server-only";
import { pool } from "@/lib/admin/db";
import type { Access } from "@/lib/plans";
import { TIERS, tierForPlan, type Tier, type TierPolicy } from "./policy";

// What one account may do in the texting assistant, resolved on the server from its real A-Zee plan.
//
// Resolution is: the plan's tier policy (policy.ts), then any registered overrides on top. An
// organisation plan (Business, Enterprise) is added later by registering an override that reads its
// admin-set policy; nothing else in the backend needs restructuring, because every caller goes
// through resolvePolicy() and nothing reads TIERS directly.

export type TypingCaps = { minIntervalSeconds: number; dailyCap: number };
export type Policy = TierPolicy & {
  tier: Tier; planId: string; planName: string;
  /** Texting-assistant requests per UTC month; null = unlimited. Counted separately from the chat allowance. */
  monthlyAllowance: number | null;
  typing: TypingCaps;
};
export type PolicyOverride = Partial<TierPolicy & { monthlyAllowance: number | null; typing: TypingCaps }>;
export type OverrideSource = (access: Access) => PolicyOverride | null;

export const TYPING_MIN_INTERVAL_SECONDS = 10;
export const TYPING_DAILY_CAP: Record<Tier, number> = { free: 20, plus: 100, premium: 300 };

const overrideSources: OverrideSource[] = [];
/** Registers a source of per-account policy overrides (for example an organisation's admin settings). */
export const registerPolicyOverride = (source: OverrideSource) => { overrideSources.push(source); };

export function resolvePolicy(access: Access): Policy {
  const tier = tierForPlan(access.planId);
  const base: Policy = {
    ...TIERS[tier], tier, planId: access.planId, planName: access.planName,
    // Launch rule: the texting allowance equals the plan's existing message allowance, but it is its own counter.
    monthlyAllowance: access.entitlements.messages?.monthlyLimit ?? null,
    typing: { minIntervalSeconds: TYPING_MIN_INTERVAL_SECONDS, dailyCap: TYPING_DAILY_CAP[tier] },
  };
  return overrideSources.reduce<Policy>((policy, source) => ({ ...policy, ...(source(access) ?? {}) }), base);
}

// --- durable, idempotent, atomic accounting -------------------------------------------------

export const periodStart = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
export const nextReset = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();

export class AllowanceExhausted extends Error {
  constructor(public limit: number) { super("PLAN_LIMIT_REACHED"); }
}

export async function textingUsed(userId: string): Promise<number> {
  const row = (await pool.query(`SELECT used FROM linqext_usage WHERE user_id = $1 AND period_start = $2`, [userId, periodStart()])).rows[0];
  return row?.used ?? 0;
}

/**
 * Charges one request to the user's texting allowance, once. The charge and the request's
 * charged_period are written in one transaction, so a retry or a takeover of a stale request finds it
 * already charged and does not charge again. The counter increments only while below the limit, in a
 * single statement, so concurrent requests can never overshoot it. Throws AllowanceExhausted.
 */
export async function chargeRequest(userId: string, requestId: string, allowance: number | null, attempt?: string): Promise<void> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const row = (await db.query(`SELECT charged_period FROM linqext_requests WHERE user_id = $1 AND request_id = $2 AND ($3::uuid IS NULL OR attempt_id = $3) AND status = 'running' FOR UPDATE`, [userId, requestId, attempt ?? null])).rows[0];
    if (!row) throw new Error('Inference attempt superseded or missing');
    if (row.charged_period) { await db.query("COMMIT"); return; }
    const period = periodStart();
    const admitted = allowance === null || allowance > 0
      ? (await db.query(
          `INSERT INTO linqext_usage (user_id, period_start, used) VALUES ($1, $2, 1)
           ON CONFLICT (user_id, period_start) DO UPDATE SET used = linqext_usage.used + 1
           WHERE $3::int IS NULL OR linqext_usage.used < $3::int RETURNING used`,
          [userId, period, allowance])).rowCount
      : 0;
    if (!admitted) { await db.query("ROLLBACK"); throw new AllowanceExhausted(allowance ?? 0); }
    await db.query(`UPDATE linqext_requests SET charged_period = $3 WHERE user_id = $1 AND request_id = $2`, [userId, requestId, period]);
    await db.query("COMMIT");
  } catch (error) {
    if (!(error instanceof AllowanceExhausted)) await db.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    db.release();
  }
}

/** Gives back the charge of a request that failed, to the period it was charged to. Safe to call twice. */
export async function refundRequest(userId: string, requestId: string, attempt?: string): Promise<void> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const row = (await db.query(
      `UPDATE linqext_requests r SET charged_period = NULL, status = 'failed'
       FROM (SELECT charged_period FROM linqext_requests WHERE user_id = $1 AND request_id = $2 AND ($3::uuid IS NULL OR attempt_id = $3) AND status = 'running' FOR UPDATE) old
       WHERE r.user_id = $1 AND r.request_id = $2 AND old.charged_period IS NOT NULL RETURNING old.charged_period AS period`,
      [userId, requestId, attempt ?? null])).rows[0];
    if (row) await db.query(`UPDATE linqext_usage SET used = GREATEST(used - 1, 0) WHERE user_id = $1 AND period_start = $2`, [userId, row.period]);
    await db.query("COMMIT");
  } catch {
    await db.query("ROLLBACK").catch(() => undefined);
  } finally {
    db.release();
  }
}
