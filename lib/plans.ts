import "server-only";
import { randomUUID } from "node:crypto";
import { pool } from "@/lib/admin/db";
import { isWalled, markQuotaExhausted } from "@/lib/abuse/signals";
import { getRegionalPrice, normalizeRegion } from "@/lib/pricing";

// Plans, subscriptions, and monthly usage limits (migration 008).

export type Feature = "messages" | "reasoning" | "research";
export type Plan = {
  id: string; name: string; interval: "month" | "user/month" | "custom"; bestFor: string | null; popular: boolean;
  features: string[]; basePriceUsd: number; annualPriceUsd: number | null;
  price: number | null; annualPrice: number | null; // regional prices; null = custom
  limits: Partial<Record<Feature, number | null>>;
};

export async function listPlans(region: string | null): Promise<Plan[]> {
  const [plans, limits] = await Promise.all([
    pool.query("SELECT * FROM plans WHERE is_active ORDER BY sort_order, id"),
    pool.query("SELECT plan_id, feature, monthly_limit FROM usage_limits"), // view over plan_entitlements
  ]);
  return plans.rows.map(p => {
    const custom = p.interval === "custom";
    const base = Number(p.base_price_usd);
    const annual = p.annual_price_usd === null ? null : Number(p.annual_price_usd);
    return {
      id: p.id, name: p.name, interval: p.interval, bestFor: p.best_for, popular: p.popular,
      features: Array.isArray(p.features) ? p.features : [],
      basePriceUsd: base, annualPriceUsd: annual,
      price: custom ? null : getRegionalPrice(base, region ?? ""),
      annualPrice: custom || annual === null ? null : getRegionalPrice(annual, region ?? ""),
      limits: Object.fromEntries(limits.rows.filter(l => l.plan_id === p.id).map(l => [l.feature, l.monthly_limit])),
    };
  });
}

/**
 * The region used for regional pricing: the account's saved region, else a country header set
 * by a trusted proxy (Cloudflare / Vercel, only when TRUST_PROXY=true), else unknown.
 * Final pricing must be confirmed by the payment provider's billing country at checkout.
 */
export function regionFrom(headers: Headers, accountRegion: string | null): string | null {
  if (accountRegion) return normalizeRegion(accountRegion);
  if (process.env.TRUST_PROXY !== "true") return null;
  return normalizeRegion(headers.get("cf-ipcountry") ?? headers.get("x-vercel-ip-country"));
}

const monthStart = () => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();

// ---------------------------------------------------------------------------
// Access rules (ported from subscription-access-rule/src/server.ts): the plan comes from the
// subscription, features come from plan_entitlements, and metered use is reserved atomically
// in usage_counters before any AI call, then refunded if the request fails.

export type AccessFeature = Feature | "research_plans" | "personalization" | "attachments" | "translation";
export type Entitlement = { enabled: boolean; monthlyLimit: number | null };

/** Who usage is counted for: the signed-in account, or a guest browser. */
export type Subject = { key: string; accountId: string | null };

export async function subjectFor(actor: { userId?: string | null; auth: { userId: string } }): Promise<Subject> {
  if (actor.userId) return { key: `account:${actor.userId}`, accountId: actor.userId };
  return { key: `guest:${actor.auth.userId}`, accountId: null };
}

/** Current plan: an active or trialing subscription whose period hasn't ended; otherwise Free. */
export async function resolvePlan(subject: Subject): Promise<string> {
  if (!subject.accountId) return "free";
  const result = await pool.query(
    `SELECT s.plan_id FROM subscriptions s JOIN plans p ON p.id = s.plan_id AND p.is_active
     WHERE s.user_id = $1 AND s.status IN ('active', 'trialing')
       AND (s.current_period_end IS NULL OR s.current_period_end > now())
     ORDER BY s.updated_at DESC LIMIT 1`,
    [subject.accountId],
  );
  return result.rows[0]?.plan_id ?? "free";
}

export async function entitlements(planId: string): Promise<Record<string, Entitlement>> {
  const result = await pool.query("SELECT feature, enabled, monthly_limit FROM plan_entitlements WHERE plan_id = $1", [planId]);
  return Object.fromEntries(result.rows.map(r => [r.feature, { enabled: r.enabled, monthlyLimit: r.monthly_limit }]));
}

const periodStart = () => monthStart().slice(0, 10);

export async function usageFor(subject: Subject): Promise<Record<string, number>> {
  const result = await pool.query("SELECT feature, used FROM usage_counters WHERE subject = $1 AND period_start = $2", [subject.key, periodStart()]);
  return Object.fromEntries(result.rows.map(r => [r.feature, r.used]));
}

/** `walled`: this free account is linked to others that already used their free allowance (lib/abuse/signals). */
export type Access = { subject: Subject; planId: string; planName: string; entitlements: Record<string, Entitlement>; walled?: boolean };

export async function accessFor(actor: { userId?: string | null; auth: { userId: string } }): Promise<Access> {
  const subject = await subjectFor(actor);
  const planId = await resolvePlan(subject);
  const [grants, plan, walled] = await Promise.all([
    entitlements(planId), pool.query("SELECT name FROM plans WHERE id = $1", [planId]),
    subject.accountId && planId === "free" ? isWalled(subject.accountId) : Promise.resolve(false),
  ]);
  return { subject, planId, planName: plan.rows[0]?.name ?? planId, entitlements: grants, walled };
}

export const can = (access: Access | null, feature: AccessFeature) => !access || access.entitlements[feature]?.enabled === true;

export class PlanLimitError extends Error {
  constructor(public feature: AccessFeature, public limit: number, public planName: string) { super("PLAN_LIMIT_REACHED"); }
}
export class UpgradeRequiredError extends Error {
  constructor(public feature: AccessFeature, public planName: string) { super("UPGRADE_REQUIRED"); }
}

async function audit(subject: Subject, feature: string, decision: "upgrade_required" | "quota_exceeded", planId: string) {
  await pool.query("INSERT INTO access_audit (subject, feature, decision, plan_id) VALUES ($1, $2, $3, $4)", [subject.key, feature, decision, planId]).catch(() => {});
}

export type Reservation = { refund(): Promise<void> };

/**
 * Admits a request: every feature must be enabled on the plan, and metered features are counted
 * atomically against their monthly limit (all or nothing, in one transaction). Throws
 * UpgradeRequiredError (403) or PlanLimitError (429). Call refund() if the request then fails.
 */
export async function reserveUsage(access: Access, features: AccessFeature[]): Promise<Reservation> {
  // The free-plan upgrade wall: a soft limit (never a ban) for accounts linked to others that
  // already used their free allowance. Paid plans and administrator-cleared accounts skip it.
  if (access.walled && access.planId === "free" && features.length) {
    await audit(access.subject, features[0], "upgrade_required", access.planId);
    throw new UpgradeRequiredError(features[0], access.planName);
  }
  const counted: string[] = [];
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    for (const feature of features) {
      const grant = access.entitlements[feature];
      if (!grant?.enabled) {
        await db.query("ROLLBACK");
        await audit(access.subject, feature, "upgrade_required", access.planId);
        throw new UpgradeRequiredError(feature, access.planName);
      }
      if (grant.monthlyLimit === null) continue;
      // A limit of 0 means none: deny without inserting (the original inserted used = 1 here).
      const admitted = grant.monthlyLimit > 0 && (await db.query(
        `INSERT INTO usage_counters (subject, feature, period_start, used) VALUES ($1, $2, $3, 1)
         ON CONFLICT (subject, feature, period_start)
         DO UPDATE SET used = usage_counters.used + 1 WHERE usage_counters.used < $4
         RETURNING used`,
        [access.subject.key, feature, periodStart(), grant.monthlyLimit],
      )).rowCount;
      if (!admitted) {
        await db.query("ROLLBACK");
        await audit(access.subject, feature, "quota_exceeded", access.planId);
        if (access.subject.accountId && access.planId === "free") await markQuotaExhausted(access.subject.accountId, feature).catch(() => undefined);
        throw new PlanLimitError(feature, grant.monthlyLimit, access.planName);
      }
      counted.push(feature);
    }
    await db.query("COMMIT");
  } catch (error) {
    if (!(error instanceof UpgradeRequiredError || error instanceof PlanLimitError)) await db.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    db.release();
  }
  return {
    async refund() {
      if (!counted.length) return;
      await pool.query(
        "UPDATE usage_counters SET used = GREATEST(used - 1, 0) WHERE subject = $1 AND period_start = $2 AND feature = ANY($3::text[])",
        [access.subject.key, periodStart(), counted],
      ).catch(() => {});
    },
  };
}

export type SubscribeResult =
  | { status: "active"; planId: string }
  | { status: "pending"; planId: string; price: number; billing: "monthly" | "annual" }
  | { status: "contact_sales"; planId: string };

/**
 * Plan selection for the local account. Free activates immediately. Paid plans become a pending
 * subscription because no payment provider is connected (an operator activates it with
 * `npm run plan:set`). Custom-priced plans are handled by sales.
 */
export async function subscribe(userId: string, planId: string, billing: "monthly" | "annual", region: string | null): Promise<SubscribeResult> {
  const plans = await listPlans(region);
  const plan = plans.find(p => p.id === planId);
  if (!plan) throw new Error("UNKNOWN_PLAN");
  if (plan.price === null) return { status: "contact_sales", planId };
  const user = (await pool.query("SELECT id FROM users WHERE id = $1", [userId])).rows[0];
  if (!user) throw new Error("NO_ACCOUNT");
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    if (plan.price === 0) {
      await db.query("UPDATE subscriptions SET status = 'canceled', ends_at = now(), updated_at = now() WHERE user_id = $1 AND status IN ('active', 'trialing', 'past_due', 'pending')", [user.id]);
      await db.query("INSERT INTO subscriptions (id, user_id, plan_id, status, region, price_paid, billing) VALUES ($1, $2, $3, 'active', $4, 0, 'monthly')", [randomUUID(), user.id, planId, region]);
      await db.query("UPDATE users SET plan = $2, updated_at = now() WHERE id = $1", [user.id, planId]);
      await db.query("COMMIT");
      return { status: "active", planId };
    }
    const price = billing === "annual" && plan.annualPrice !== null ? plan.annualPrice : plan.price;
    await db.query("UPDATE subscriptions SET status = 'canceled', ends_at = now() WHERE user_id = $1 AND status = 'pending'", [user.id]);
    await db.query(
      "INSERT INTO subscriptions (id, user_id, plan_id, status, region, price_paid, billing) VALUES ($1, $2, $3, 'pending', $4, NULL, $5)",
      [randomUUID(), user.id, planId, region, billing === "annual" && plan.annualPrice !== null ? "annual" : "monthly"],
    );
    await db.query("COMMIT");
    return { status: "pending", planId, price, billing: billing === "annual" && plan.annualPrice !== null ? "annual" : "monthly" };
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}

export async function currentSubscription(userId: string) {
  const result = await pool.query(
    `SELECT s.plan_id, s.status, s.billing, s.started_at, s.current_period_end, s.cancel_at_period_end, s.provider, p.name FROM subscriptions s JOIN plans p ON p.id = s.plan_id
     WHERE s.user_id = $1 AND s.status IN ('active', 'pending') ORDER BY s.status`, [userId],
  );
  const active = result.rows.find(r => r.status === "active");
  const pending = result.rows.find(r => r.status === "pending");
  return {
    active: active ? {
      planId: active.plan_id, name: active.name, billing: active.billing, since: new Date(active.started_at).toISOString(),
      renewsOn: active.current_period_end ? new Date(active.current_period_end).toISOString() : null,
      cancelAtPeriodEnd: Boolean(active.cancel_at_period_end), charged: active.provider === "stripe",
    } : null,
    pending: pending ? { planId: pending.plan_id, name: pending.name, billing: pending.billing } : null,
  };
}
