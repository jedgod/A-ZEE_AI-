import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { pool } from "@/lib/admin/db";

// Billing webhook (completes subscription-access-rule's stub). Provider-neutral format:
//   header  X-Billing-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
//   body    { id, type, data: { accountId | email, planId, status?, providerSubscriptionId,
//             providerCustomerId?, currentPeriodEnd?, billing?, pricePaid?, currency? } }
// Adapt `verifySignature` / the payload mapping for your payment provider (Stripe, Paddle, ...).

export const TOLERANCE_SECONDS = 300;

export function sign(secret: string, timestamp: number, rawBody: string) {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export function verifySignature(header: string | null, rawBody: string, secret: string, now = Date.now()): boolean {
  const parts = Object.fromEntries((header ?? "").split(",").map(p => p.trim().split("=", 2) as [string, string]));
  const timestamp = Number(parts.t);
  if (!Number.isInteger(timestamp) || !/^[a-f0-9]{64}$/.test(parts.v1 ?? "")) return false;
  if (Math.abs(now / 1000 - timestamp) > TOLERANCE_SECONDS) return false; // replay window
  const expected = Buffer.from(sign(secret, timestamp, rawBody), "hex");
  const given = Buffer.from(parts.v1, "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export const eventSchema = z.object({
  id: z.string().min(1).max(200),
  type: z.enum(["subscription.activated", "subscription.updated", "subscription.past_due", "subscription.canceled"]),
  data: z.object({
    accountId: z.string().max(100).optional(),
    email: z.string().email().max(254).optional(),
    planId: z.string().regex(/^[a-z0-9-]{1,40}$/),
    status: z.enum(["active", "trialing"]).optional(),
    providerSubscriptionId: z.string().min(1).max(200),
    providerCustomerId: z.string().max(200).optional(),
    currentPeriodEnd: z.string().datetime().optional(),
    billing: z.enum(["monthly", "annual"]).optional(),
    pricePaid: z.number().nonnegative().optional(),
    currency: z.string().regex(/^[A-Z]{3}$/).optional(),
    provider: z.string().max(40).optional(),
  }).strict().refine(d => d.accountId || d.email, { message: "accountId or email required" }),
}).strict();

export class BillingError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

/** Applies one verified event exactly once. Returns false if it was already applied. */
export async function applyBillingEvent(event: z.infer<typeof eventSchema>): Promise<boolean> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const fresh = await db.query("INSERT INTO billing_events (id, type) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING", [event.id, event.type]);
    if (!fresh.rowCount) { await db.query("ROLLBACK"); return false; }

    const d = event.data;
    const user = (await db.query("SELECT id FROM users WHERE id = $1 OR lower(email) = lower($2) LIMIT 1", [d.accountId ?? "", d.email ?? ""])).rows[0];
    if (!user) throw new BillingError(422, "UNKNOWN_ACCOUNT");
    const plan = (await db.query("SELECT id FROM plans WHERE id = $1", [d.planId])).rows[0];
    if (!plan) throw new BillingError(422, "UNKNOWN_PLAN");
    const existing = (await db.query("SELECT id FROM subscriptions WHERE provider_subscription_id = $1 FOR UPDATE", [d.providerSubscriptionId])).rows[0];

    if (event.type === "subscription.canceled" || event.type === "subscription.past_due") {
      if (!existing) throw new BillingError(422, "UNKNOWN_SUBSCRIPTION");
      const canceled = event.type === "subscription.canceled";
      await db.query(
        `UPDATE subscriptions SET status = $2, ends_at = CASE WHEN $3 THEN now() ELSE ends_at END, updated_at = now() WHERE id = $1`,
        [existing.id, canceled ? "canceled" : "past_due", canceled],
      );
      // Past-due and canceled subscriptions no longer grant access (resolvePlan).
      await db.query("UPDATE users SET plan = 'free', updated_at = now() WHERE id = $1", [user.id]);
    } else {
      const status = d.status ?? "active";
      const fields = [d.planId, status, d.currentPeriodEnd ?? null, d.providerCustomerId ?? null, d.provider ?? "webhook", d.billing ?? "monthly", d.pricePaid ?? null, d.currency ?? "USD"];
      if (existing) {
        await db.query(
          `UPDATE subscriptions SET plan_id = $2, status = $3, current_period_end = $4, provider_customer_id = coalesce($5, provider_customer_id),
             provider = $6, billing = $7, price_paid = coalesce($8, price_paid), currency = $9, updated_at = now() WHERE id = $1`,
          [existing.id, ...fields],
        );
      } else {
        // A new paid subscription replaces whatever was current; a matching pending one is promoted.
        await db.query("UPDATE subscriptions SET status = 'canceled', ends_at = now(), updated_at = now() WHERE user_id = $1 AND status IN ('active', 'trialing', 'past_due')", [user.id]);
        const pending = (await db.query("SELECT id FROM subscriptions WHERE user_id = $1 AND status = 'pending' AND plan_id = $2", [user.id, d.planId])).rows[0];
        await db.query("UPDATE subscriptions SET status = 'canceled', updated_at = now() WHERE user_id = $1 AND status = 'pending' AND id <> $2", [user.id, pending?.id ?? ""]);
        if (pending) {
          await db.query(
            `UPDATE subscriptions SET plan_id = $2, status = $3, current_period_end = $4, provider_customer_id = $5, provider = $6, billing = $7,
               price_paid = $8, currency = $9, provider_subscription_id = $10, started_at = now(), updated_at = now() WHERE id = $1`,
            [pending.id, ...fields, d.providerSubscriptionId],
          );
        } else {
          await db.query(
            `INSERT INTO subscriptions (id, user_id, plan_id, status, current_period_end, provider_customer_id, provider, billing, price_paid, currency, provider_subscription_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [randomUUID(), user.id, ...fields, d.providerSubscriptionId],
          );
        }
      }
      await db.query("UPDATE users SET plan = $2, updated_at = now() WHERE id = $1", [user.id, d.planId]);
    }
    await db.query("COMMIT");
    return true;
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    db.release();
  }
}
