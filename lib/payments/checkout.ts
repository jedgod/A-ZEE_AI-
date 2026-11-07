import "server-only";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { pool } from "@/lib/admin/db";
import { applyBillingEvent } from "@/lib/billing";
import { listPlans, regionFrom, subscribe } from "@/lib/plans";
import { allow } from "@/lib/users/auth";
import { notify } from "@/lib/users/features";
import { UserError, type SessionUser } from "@/lib/users/types";
import {
  createPaymentIntent, getPaymentIntent, paymentsConfigured, StripeError, type StripePaymentIntent,
} from "./stripe";

// Charging a user's saved payment method for a plan. The price is always computed on the server
// from the plan table (the browser only says which plan, and what price it was shown); a charge
// is made off-session against the user's own Stripe customer; and a plan is activated only once
// Stripe reports the charge succeeded, through the same billing event path as any other provider.

export const checkoutInput = z.object({
  planId: z.string().regex(/^[a-z0-9-]{1,40}$/),
  billing: z.enum(["monthly", "annual"]).default("monthly"),
  expectedPrice: z.number().nonnegative().optional(),
}).strict();

export type CheckoutResult =
  | { status: "active"; planId: string }
  | { status: "processing"; planId: string }
  | { status: "requires_action"; clientSecret: string; publishableKey: string }
  | { status: "payment_method_required" }
  | { status: "price_changed"; price: number }
  | { status: "failed"; code: string };

const cents = (usd: number) => Math.round(usd * 100);
const periodEnd = (from: Date, billing: "monthly" | "annual") => {
  const d = new Date(from);
  if (billing === "annual") d.setUTCFullYear(d.getUTCFullYear() + 1); else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
};

async function defaultMethod(userId: string) {
  const r = await pool.query(
    `SELECT pm.provider_payment_method_id AS pm, c.provider_customer_id AS customer FROM payment_methods pm
     JOIN payment_customers c ON c.user_id = pm.user_id WHERE pm.user_id = $1 ORDER BY pm.is_default DESC, pm.created_at DESC LIMIT 1`, [userId]);
  return r.rows[0] as { pm: string; customer: string } | undefined;
}

async function record(userId: string, subscriptionId: string | null, planId: string, kind: "signup" | "renewal", billing: string, pi: StripePaymentIntent, status: "processing" | "succeeded" | "failed", failure: string | null = null) {
  await pool.query(
    `INSERT INTO payments (user_id, subscription_id, plan_id, kind, billing, provider_payment_intent_id, amount_cents, currency, status, failure_code)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (provider_payment_intent_id) DO UPDATE SET status = EXCLUDED.status, failure_code = EXCLUDED.failure_code, updated_at = now()
     WHERE payments.status <> 'succeeded'`,
    [userId, subscriptionId, planId, kind, billing, pi.id, pi.amount, pi.currency, status, failure]);
}

/** Subscribes the user to a paid plan, charging their default saved method. */
export async function checkout(user: SessionUser, raw: unknown, headers: Headers): Promise<CheckoutResult> {
  if (!paymentsConfigured()) throw new UserError(503, "PAYMENTS_NOT_CONFIGURED");
  const input = checkoutInput.parse(raw);
  // Regional discounts rely on a country the user could type into their profile; a charge only
  // honors one reported by a trusted proxy header, never the self-declared region.
  const plan = (await listPlans(regionFrom(headers, null))).find(p => p.id === input.planId);
  if (!plan || plan.price === null || plan.price <= 0) throw new UserError(422, "NOT_A_PAID_PLAN");
  const billing = input.billing === "annual" && plan.annualPrice !== null ? "annual" : "monthly";
  const price = billing === "annual" ? plan.annualPrice! : plan.price;
  if (input.expectedPrice !== undefined && cents(input.expectedPrice) !== cents(price)) return { status: "price_changed", price };

  const method = await defaultMethod(user.id);
  if (!method) return { status: "payment_method_required" };

  // A double click or a retry must never charge twice: refuse while a charge for this plan is
  // still settling, and treat one that just succeeded as done.
  if (!await allow("checkout", user.id, 3)) throw new UserError(429, "RATE_LIMITED");
  const recent = (await pool.query(
    `SELECT status FROM payments WHERE user_id = $1 AND plan_id = $2 AND kind = 'signup' AND status IN ('processing', 'succeeded')
       AND created_at > now() - interval '10 minutes' ORDER BY created_at DESC LIMIT 1`, [user.id, plan.id])).rows[0];
  if (recent) return recent.status === "succeeded" ? { status: "active", planId: plan.id } : { status: "processing", planId: plan.id };

  const subscribed = await subscribe(user.id, plan.id, billing, null); // reserves a pending subscription
  if (subscribed.status !== "pending") throw new UserError(422, "NOT_A_PAID_PLAN");
  const sub = (await pool.query(`SELECT id FROM subscriptions WHERE user_id = $1 AND status = 'pending' AND plan_id = $2`, [user.id, plan.id])).rows[0];
  const metadata = { user_id: user.id, plan_id: plan.id, billing, subscription_id: sub.id, kind: "signup" };

  let intent: StripePaymentIntent;
  try {
    intent = await createPaymentIntent({ amount: cents(price), customer: method.customer, paymentMethod: method.pm, description: `AZ_AI ${plan.name} (${billing})`, metadata }, `signup-${sub.id}`);
  } catch (error) {
    if (!(error instanceof StripeError)) throw error;
    if (error.code === "authentication_required" && error.intentId) {
      // The bank wants the customer to confirm (3-D Secure): hand the browser what it needs.
      const pending = await getPaymentIntent(error.intentId);
      await record(user.id, sub.id, plan.id, "signup", billing, pending, "processing");
      return { status: "requires_action", clientSecret: pending.client_secret!, publishableKey: process.env.STRIPE_PUBLISHABLE_KEY! };
    }
    console.warn("charge failed:", error.status, error.code);
    return { status: "failed", code: error.code === "card_declined" || error.code === "expired_card" || error.code === "insufficient_funds" ? error.code : "payment_failed" };
  }
  return settle(user.id, intent, "signup");
}

/** Records what Stripe says about a charge; activates the plan only when it has succeeded. */
async function settle(userId: string, intent: StripePaymentIntent, kind: "signup" | "renewal"): Promise<CheckoutResult> {
  const m = intent.metadata ?? {};
  if (intent.status === "succeeded") {
    await activate(userId, intent, kind);
    return { status: "active", planId: m.plan_id };
  }
  if (intent.status === "processing") { // bank debits settle in a few days; the webhook finishes the job
    await record(userId, m.subscription_id ?? null, m.plan_id, kind, m.billing ?? "monthly", intent, "processing");
    return { status: "processing", planId: m.plan_id };
  }
  await record(userId, m.subscription_id ?? null, m.plan_id, kind, m.billing ?? "monthly", intent, "failed", intent.last_payment_error?.code ?? "payment_failed");
  return { status: "failed", code: intent.last_payment_error?.code ?? "payment_failed" };
}

/** Marks the charge paid and activates or extends the subscription. Safe to run twice. */
async function activate(userId: string, intent: StripePaymentIntent, kind: "signup" | "renewal") {
  const m = intent.metadata ?? {};
  const sub = (await pool.query(`SELECT id, current_period_end FROM subscriptions WHERE id = $1 AND user_id = $2`, [m.subscription_id ?? "", userId])).rows[0];
  if (!sub) throw new UserError(422, "UNKNOWN_SUBSCRIPTION");
  const billing = m.billing === "annual" ? "annual" : "monthly";
  const base = kind === "renewal" && sub.current_period_end && new Date(sub.current_period_end) > new Date() ? new Date(sub.current_period_end) : new Date();
  await record(userId, sub.id, m.plan_id, kind, billing, intent, "succeeded");
  const fresh = await applyBillingEvent({
    id: `stripe:${intent.id}`, type: kind === "signup" ? "subscription.activated" : "subscription.updated",
    data: {
      accountId: userId, planId: m.plan_id, status: "active", providerSubscriptionId: `az:${sub.id}`, providerCustomerId: intent.customer ?? undefined,
      currentPeriodEnd: periodEnd(base, billing).toISOString(), billing, pricePaid: (intent.amount_received || intent.amount) / 100, currency: "USD", provider: "stripe",
    },
  });
  if (fresh) await notify(userId, "Payment received", `We charged $${((intent.amount_received || intent.amount) / 100).toFixed(2)} for your ${kind === "signup" ? "new plan" : "renewal"}. Thank you.`).catch(() => undefined);
}

// ---- Stripe webhook: charges that finished after the request returned ----

export async function handleCheckoutEvent(event: { id: string; type: string; data: { object: any } }): Promise<void> {
  if (event.type !== "payment_intent.succeeded" && event.type !== "payment_intent.payment_failed") return;
  const object = event.data?.object ?? {};
  const m = (object.metadata ?? {}) as Record<string, string>;
  if (!m.user_id || !m.plan_id || !m.subscription_id || (m.kind !== "signup" && m.kind !== "renewal")) return; // not one of ours
  // The charge must be on this user's own Stripe customer; metadata alone is never trusted.
  const owner = (await pool.query(`SELECT 1 FROM payment_customers WHERE user_id = $1 AND provider_customer_id = $2`, [m.user_id, object.customer])).rowCount;
  if (!owner) return;
  const intent: StripePaymentIntent = {
    id: object.id, status: object.status, customer: object.customer, amount: object.amount, amount_received: object.amount_received ?? 0,
    currency: object.currency, metadata: m, last_payment_error: object.last_payment_error,
  };
  if (event.type === "payment_intent.succeeded") { await activate(m.user_id, intent, m.kind as "signup" | "renewal"); return; }
  await record(m.user_id, m.subscription_id, m.plan_id, m.kind as "signup" | "renewal", m.billing ?? "monthly", intent, "failed", object.last_payment_error?.code ?? "payment_failed");
  if (m.kind === "renewal") {
    await applyBillingEvent({ id: `stripe:${object.id}:failed`, type: "subscription.past_due", data: { accountId: m.user_id, planId: m.plan_id, providerSubscriptionId: `az:${m.subscription_id}` } }).catch(() => false);
    await notify(m.user_id, "Payment failed", "We couldn't renew your plan. Update your payment method, then choose your plan again to restore access.").catch(() => undefined);
  }
}

// ---- renewals (run from a scheduler) ----

export function cronAuthorized(header: string | null): boolean {
  const secret = process.env.BILLING_CRON_SECRET;
  if (!secret || secret.length < 32 || !header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice(7)), expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Charges every active Stripe subscription whose period has ended, and ends the ones set to cancel. */
export async function renewDue(limit = 50): Promise<{ renewed: number; processing: number; failed: number; canceled: number }> {
  const out = { renewed: 0, processing: 0, failed: 0, canceled: 0 };
  if (!paymentsConfigured()) return out;
  const due = (await pool.query(
    `SELECT id, user_id, plan_id, billing, price_paid, current_period_end, cancel_at_period_end FROM subscriptions
     WHERE status = 'active' AND provider = 'stripe' AND current_period_end IS NOT NULL AND current_period_end <= now()
     ORDER BY current_period_end LIMIT $1`, [limit])).rows;
  for (const s of due) {
    try {
      if (s.cancel_at_period_end) {
        await applyBillingEvent({ id: `stripe:cancel:${s.id}:${new Date(s.current_period_end).getTime()}`, type: "subscription.canceled", data: { accountId: s.user_id, planId: s.plan_id, providerSubscriptionId: `az:${s.id}` } });
        await notify(s.user_id, "Plan ended", "Your plan has ended as you requested. You're now on the Free plan.").catch(() => undefined);
        out.canceled++; continue;
      }
      const method = await defaultMethod(s.user_id);
      const amount = cents(Number(s.price_paid));
      if (!method || amount <= 0) throw new Error("no method or amount");
      const periodKey = new Date(s.current_period_end).getTime();
      const metadata = { user_id: s.user_id, plan_id: s.plan_id, billing: s.billing, subscription_id: s.id, kind: "renewal" };
      const intent = await createPaymentIntent({ amount, customer: method.customer, paymentMethod: method.pm, description: `AZ_AI renewal (${s.billing})`, metadata }, `renew-${s.id}-${periodKey}`);
      const result = await settle(s.user_id, intent, "renewal");
      if (result.status === "active") out.renewed++; else if (result.status === "processing") out.processing++; else throw new Error("charge not successful");
    } catch (error) {
      out.failed++;
      console.warn("renewal failed for subscription", s.id, (error as Error).message?.slice(0, 120));
      await applyBillingEvent({ id: `stripe:renew-failed:${s.id}:${new Date(s.current_period_end).getTime()}`, type: "subscription.past_due", data: { accountId: s.user_id, planId: s.plan_id, providerSubscriptionId: `az:${s.id}` } }).catch(() => false);
      await notify(s.user_id, "Payment failed", "We couldn't renew your plan. Update your payment method, then choose your plan again to restore access.").catch(() => undefined);
    }
  }
  return out;
}

// ---- cancel at period end, payment history ----

export async function setCancelAtPeriodEnd(userId: string, cancel: boolean) {
  const r = await pool.query(
    `UPDATE subscriptions SET cancel_at_period_end = $2, updated_at = now() WHERE user_id = $1 AND status = 'active' AND provider = 'stripe' RETURNING current_period_end`, [userId, cancel]);
  if (!r.rowCount) throw new UserError(404, "NO_ACTIVE_SUBSCRIPTION");
  await notify(userId, cancel ? "Plan will end" : "Plan will renew", cancel
    ? `Your plan stays active until ${new Date(r.rows[0].current_period_end).toLocaleDateString("en-US")}, then ends. You won't be charged again.`
    : "Cancellation undone. Your plan will renew as usual.").catch(() => undefined);
}

export async function listPayments(userId: string) {
  const r = await pool.query(
    `SELECT p.id, p.plan_id, pl.name AS plan_name, p.kind, p.billing, p.amount_cents, p.currency, p.status, p.failure_code, p.created_at
     FROM payments p LEFT JOIN plans pl ON pl.id = p.plan_id WHERE p.user_id = $1 ORDER BY p.created_at DESC LIMIT 50`, [userId]);
  return r.rows.map(p => ({
    id: p.id as string, plan: (p.plan_name ?? p.plan_id) as string, kind: p.kind as string, billing: p.billing as string,
    amount: p.amount_cents / 100, currency: String(p.currency).toUpperCase(), status: p.status as string,
    failureCode: (p.failure_code as string) ?? null, createdAt: new Date(p.created_at).toISOString(),
  }));
}
