import "server-only";
import { z } from "zod";
import { pool, transaction } from "@/lib/admin/db";
import { allow } from "@/lib/users/auth";
import { notify } from "@/lib/users/features";
import { UserError, type SessionUser } from "@/lib/users/types";
import {
  createCustomer, createSetupIntent, detachPaymentMethod, getPaymentMethod, getSetupIntent, paymentsConfigured,
  setDefaultPaymentMethod, StripeError, type StripePaymentMethod,
} from "./stripe";

// Saved payment methods for signed-in users. The server stores Stripe's token and display details
// only. Everything shown or saved is re-read from Stripe by id, never taken from the browser, and
// a token only saves if Stripe says it belongs to this user's own Stripe customer.

export const MAX_METHODS = 10;
const uuid = z.string().uuid();
const pmId = z.string().regex(/^pm_[A-Za-z0-9]{8,80}$/);

export type MethodView = {
  id: string; kind: "card" | "bank_account"; brand: string | null; funding: string | null; accountType: string | null;
  last4: string; expMonth: number | null; expYear: number | null; isDefault: boolean; createdAt: string;
};

const view = (r: any): MethodView => ({
  id: r.id, kind: r.kind, brand: r.brand, funding: r.funding, accountType: r.account_type, last4: r.last4,
  expMonth: r.exp_month, expYear: r.exp_year, isDefault: r.is_default, createdAt: new Date(r.created_at).toISOString(),
});

function guard() {
  if (!paymentsConfigured()) throw new UserError(503, "PAYMENTS_NOT_CONFIGURED");
}
/** Provider failures become a safe, generic error for the browser. */
async function provider<T>(work: Promise<T>): Promise<T> {
  try { return await work; }
  catch (error) {
    if (error instanceof StripeError) {
      console.warn("payment provider error:", error.status, error.code);
      throw new UserError(error.status === 404 ? 404 : 502, error.status === 404 ? "PAYMENT_METHOD_NOT_FOUND" : "PAYMENT_PROVIDER_ERROR");
    }
    throw error;
  }
}

export async function listMethods(userId: string): Promise<MethodView[]> {
  const r = await pool.query(`SELECT * FROM payment_methods WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC`, [userId]);
  return r.rows.map(view);
}

async function customerId(user: SessionUser): Promise<string> {
  const found = await pool.query(`SELECT provider_customer_id FROM payment_customers WHERE user_id = $1`, [user.id]);
  if (found.rows[0]) return found.rows[0].provider_customer_id;
  const created = await provider(createCustomer(user.email, user.name, user.id)); // idempotent per user
  await pool.query(`INSERT INTO payment_customers (user_id, provider_customer_id) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING`, [user.id, created.id]);
  return (await pool.query(`SELECT provider_customer_id FROM payment_customers WHERE user_id = $1`, [user.id])).rows[0].provider_customer_id;
}

export const setupInput = z.object({ kind: z.enum(["card", "bank_account"]) }).strict();

/** Step 1: a one-time client secret the browser gives to Stripe's form. No card data is involved. */
export async function startSetup(user: SessionUser, raw: unknown) {
  guard();
  const { kind } = setupInput.parse(raw);
  if (!await allow("pm-setup", user.id, 5)) throw new UserError(429, "RATE_LIMITED");
  const count = await pool.query(`SELECT count(*)::int AS n FROM payment_methods WHERE user_id = $1`, [user.id]);
  if (count.rows[0].n >= MAX_METHODS) throw new UserError(422, "TOO_MANY_METHODS");
  const intent = await provider(createSetupIntent(await customerId(user), kind, user.id));
  return { clientSecret: intent.client_secret, publishableKey: process.env.STRIPE_PUBLISHABLE_KEY! };
}

function details(pm: StripePaymentMethod) {
  if (pm.type === "card" && pm.card) {
    const funding = ["debit", "credit", "prepaid"].includes(pm.card.funding ?? "") ? pm.card.funding! : "unknown";
    return { kind: "card" as const, brand: pm.card.brand.slice(0, 40), funding, accountType: null, last4: pm.card.last4, expMonth: pm.card.exp_month, expYear: pm.card.exp_year };
  }
  if (pm.type === "us_bank_account" && pm.us_bank_account) {
    const type = pm.us_bank_account.account_type;
    return { kind: "bank_account" as const, brand: pm.us_bank_account.bank_name?.slice(0, 40) ?? null, funding: null, accountType: type === "checking" || type === "savings" ? type : null, last4: pm.us_bank_account.last4, expMonth: null, expYear: null };
  }
  return null;
}

/**
 * Saves (or refreshes) a payment method after Stripe confirms it. Used by the browser after it
 * finishes the form and by the webhook; both end up here. The token must belong to this user's
 * own Stripe customer, so one user can't save another's.
 */
export async function syncMethod(userId: string, paymentMethodId: string, announce = true): Promise<MethodView> {
  guard();
  const id = pmId.parse(paymentMethodId);
  const customer = (await pool.query(`SELECT provider_customer_id FROM payment_customers WHERE user_id = $1`, [userId])).rows[0]?.provider_customer_id;
  if (!customer) throw new UserError(403, "PAYMENT_METHOD_NOT_YOURS");
  const pm = await provider(getPaymentMethod(id));
  if (pm.customer !== customer) throw new UserError(403, "PAYMENT_METHOD_NOT_YOURS");
  const d = details(pm);
  if (!d) throw new UserError(422, "UNSUPPORTED_PAYMENT_METHOD");

  const { row, created } = await transaction(async db => {
    const existing = await db.query(`SELECT id FROM payment_methods WHERE provider_payment_method_id = $1 AND user_id = $2`, [id, userId]);
    if (!existing.rowCount) {
      const count = await db.query(`SELECT count(*)::int AS n FROM payment_methods WHERE user_id = $1`, [userId]);
      if (count.rows[0].n >= MAX_METHODS) throw new UserError(422, "TOO_MANY_METHODS");
    }
    const hasDefault = (await db.query(`SELECT 1 FROM payment_methods WHERE user_id = $1 AND is_default`, [userId])).rowCount;
    const r = await db.query(
      `INSERT INTO payment_methods (user_id, provider_payment_method_id, kind, brand, funding, account_type, last4, exp_month, exp_year, is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (provider_payment_method_id) DO UPDATE SET brand = EXCLUDED.brand, funding = EXCLUDED.funding, account_type = EXCLUDED.account_type,
         last4 = EXCLUDED.last4, exp_month = EXCLUDED.exp_month, exp_year = EXCLUDED.exp_year
       WHERE payment_methods.user_id = EXCLUDED.user_id
       RETURNING *`,
      [userId, id, d.kind, d.brand, d.funding, d.accountType, d.last4, d.expMonth, d.expYear, !hasDefault]);
    if (!r.rowCount) throw new UserError(403, "PAYMENT_METHOD_NOT_YOURS");
    return { row: r.rows[0], created: !existing.rowCount };
  });
  if (row.is_default) await provider(setDefaultPaymentMethod(customer, id)).catch(() => undefined);
  if (created && announce) {
    const what = d.kind === "card" ? `${d.brand} card` : `${d.accountType ?? "bank"} account`;
    await notify(userId, "Payment method added", `A ${what} ending in ${d.last4} was saved to your account. If this wasn't you, remove it and change your password.`).catch(() => undefined);
  }
  return view(row);
}

/**
 * Browser path: the client names the SetupIntent it just completed (not a payment method). The
 * server reads that intent from Stripe, checks it belongs to this user's customer, and saves the
 * method Stripe attached to it. A bank account still awaiting verification is reported as pending
 * and saved later by the webhook.
 */
export async function finishSetup(user: SessionUser, raw: unknown): Promise<{ pending: boolean; method: MethodView | null }> {
  guard();
  const { setupIntentId } = z.object({ setupIntentId: z.string().regex(/^seti_[A-Za-z0-9]{8,80}$/) }).strict().parse(raw);
  if (!await allow("pm-save", user.id, 10)) throw new UserError(429, "RATE_LIMITED");
  const customer = (await pool.query(`SELECT provider_customer_id FROM payment_customers WHERE user_id = $1`, [user.id])).rows[0]?.provider_customer_id;
  const intent = await provider(getSetupIntent(setupIntentId));
  if (!customer || intent.customer !== customer) throw new UserError(403, "PAYMENT_METHOD_NOT_YOURS");
  if (intent.status !== "succeeded" || !intent.payment_method) {
    if (["requires_action", "processing", "requires_confirmation"].includes(intent.status)) return { pending: true, method: null };
    throw new UserError(422, "SETUP_NOT_COMPLETED");
  }
  return { pending: false, method: await syncMethod(user.id, intent.payment_method) };
}

export async function makeDefault(user: SessionUser, idRaw: unknown): Promise<MethodView[]> {
  guard();
  const id = uuid.parse(idRaw);
  const row = (await pool.query(`SELECT provider_payment_method_id FROM payment_methods WHERE id = $1 AND user_id = $2`, [id, user.id])).rows[0];
  if (!row) throw new UserError(404, "PAYMENT_METHOD_NOT_FOUND");
  const customer = await customerId(user);
  await provider(setDefaultPaymentMethod(customer, row.provider_payment_method_id));
  await transaction(async db => {
    await db.query(`UPDATE payment_methods SET is_default = false WHERE user_id = $1 AND is_default`, [user.id]);
    await db.query(`UPDATE payment_methods SET is_default = true WHERE id = $1 AND user_id = $2`, [id, user.id]);
  });
  return listMethods(user.id);
}

export async function removeMethod(user: SessionUser, idRaw: unknown): Promise<MethodView[]> {
  guard();
  const id = uuid.parse(idRaw);
  const row = (await pool.query(`SELECT * FROM payment_methods WHERE id = $1 AND user_id = $2`, [id, user.id])).rows[0];
  if (!row) throw new UserError(404, "PAYMENT_METHOD_NOT_FOUND");
  // Detach at Stripe first so a removed method can never be charged; "already gone" is fine.
  try { await detachPaymentMethod(row.provider_payment_method_id); }
  catch (error) { if (!(error instanceof StripeError && (error.status === 404 || error.code === "resource_missing"))) await provider(Promise.reject(error)); }
  await transaction(async db => {
    await db.query(`DELETE FROM payment_methods WHERE id = $1 AND user_id = $2`, [id, user.id]);
    if (row.is_default) {
      const next = (await db.query(`SELECT id FROM payment_methods WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [user.id])).rows[0];
      if (next) await db.query(`UPDATE payment_methods SET is_default = true WHERE id = $1`, [next.id]);
    }
  });
  const what = row.kind === "card" ? `${row.brand ?? "card"} card` : `${row.account_type ?? "bank"} account`;
  await notify(user.id, "Payment method removed", `Your ${what} ending in ${row.last4} was removed.`).catch(() => undefined);
  return listMethods(user.id);
}

// ---- Stripe webhook events ----

export type StripeEvent = { id: string; type: string; data: { object: any } };

/** Applies the events that matter for saved methods. Safe to receive twice. */
export async function handleStripeEvent(event: StripeEvent): Promise<void> {
  const object = event.data?.object ?? {};
  if (event.type === "setup_intent.succeeded" && typeof object.customer === "string" && typeof object.payment_method === "string") {
    // Completes flows the browser couldn't (bank accounts verified later, closed tabs).
    const owner = (await pool.query(`SELECT user_id FROM payment_customers WHERE provider_customer_id = $1`, [object.customer])).rows[0];
    if (owner) await syncMethod(owner.user_id, object.payment_method).catch(error => console.warn("stripe sync failed:", (error as Error).message));
  } else if (event.type === "payment_method.detached" && typeof object.id === "string") {
    const r = await pool.query(`DELETE FROM payment_methods WHERE provider_payment_method_id = $1 RETURNING user_id, is_default`, [object.id]);
    for (const row of r.rows) if (row.is_default) await pool.query(
      `UPDATE payment_methods SET is_default = true WHERE id = (SELECT id FROM payment_methods WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1)`, [row.user_id]);
  } else if (event.type === "payment_method.updated" && object.type === "card" && object.card && typeof object.id === "string") {
    await pool.query(`UPDATE payment_methods SET exp_month = $2, exp_year = $3, last4 = $4 WHERE provider_payment_method_id = $1`,
      [object.id, object.card.exp_month, object.card.exp_year, object.card.last4]);
  }
}

