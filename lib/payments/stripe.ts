import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// A minimal Stripe REST client (no SDK). Secrets stay on the server; card and bank details are
// collected by Stripe's own browser elements and never pass through here.

const BASE = "https://api.stripe.com/v1";

export class StripeError extends Error {
  constructor(public status: number, public code: string, public intentId: string | null = null) { super(code); }
}

export const paymentsConfigured = () => Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PUBLISHABLE_KEY);

type Params = { [key: string]: string | number | boolean | undefined | string[] | Params };

/** Stripe's form encoding: nested objects as a[b]=1, arrays as a[0]=x. */
export function encode(params: Params, prefix = "", out = new URLSearchParams()): URLSearchParams {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) value.forEach((v, i) => out.append(`${name}[${i}]`, String(v)));
    else if (typeof value === "object") encode(value, name, out);
    else out.append(name, String(value));
  }
  return out;
}

async function call<T>(method: "GET" | "POST" | "DELETE", path: string, params: Params = {}, idempotencyKey?: string): Promise<T> {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new StripeError(503, "PAYMENTS_NOT_CONFIGURED");
  const body = method === "GET" ? undefined : encode(params).toString();
  const query = method === "GET" && Object.keys(params).length ? `?${encode(params)}` : "";
  const response = await fetch(`${BASE}${path}${query}`, {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      ...(body !== undefined ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    // Only Stripe's machine-readable code is kept: its messages can echo card details back.
    const intent = data?.error?.payment_intent?.id;
    throw new StripeError(response.status, String(data?.error?.code ?? data?.error?.type ?? "stripe_error").slice(0, 60), typeof intent === "string" ? intent : null);
  }
  return data as T;
}

export type StripePaymentMethod = {
  id: string; type: string; customer: string | null;
  card?: { brand: string; last4: string; exp_month: number; exp_year: number; funding?: string };
  us_bank_account?: { bank_name?: string; last4: string; account_type?: string };
};
export type StripeSetupIntent = { id: string; status: string; customer: string | null; payment_method: string | null };

export const createCustomer = (email: string, name: string, userId: string) =>
  call<{ id: string }>("POST", "/customers", { email, name, metadata: { user_id: userId } }, `customer-${userId}`);

export const createSetupIntent = (customer: string, kind: "card" | "bank_account", userId: string) =>
  call<{ client_secret: string }>("POST", "/setup_intents", kind === "card"
    ? { customer, usage: "off_session", payment_method_types: ["card"], metadata: { user_id: userId } }
    : {
        customer, usage: "off_session", payment_method_types: ["us_bank_account"], metadata: { user_id: userId },
        payment_method_options: { us_bank_account: { financial_connections: { permissions: ["payment_method"] }, verification_method: "automatic" } },
      });

export type StripePaymentIntent = {
  id: string; status: string; customer: string | null; amount: number; amount_received: number; currency: string;
  client_secret?: string; metadata?: Record<string, string>; last_payment_error?: { code?: string } | null;
};

/** Charges a saved method off-session. The idempotency key makes a retried request charge once. */
export const createPaymentIntent = (params: { amount: number; customer: string; paymentMethod: string; description: string; metadata: Record<string, string> }, idempotencyKey: string) =>
  call<StripePaymentIntent>("POST", "/payment_intents", {
    amount: params.amount, currency: "usd", customer: params.customer, payment_method: params.paymentMethod,
    off_session: true, confirm: true, description: params.description, metadata: params.metadata,
  }, idempotencyKey);
export const getPaymentIntent = (id: string) => call<StripePaymentIntent>("GET", `/payment_intents/${encodeURIComponent(id)}`);

export const getPaymentMethod = (id: string) => call<StripePaymentMethod>("GET", `/payment_methods/${encodeURIComponent(id)}`);
export const getSetupIntent = (id: string) => call<StripeSetupIntent>("GET", `/setup_intents/${encodeURIComponent(id)}`);
/** Deletes the Stripe customer, which also detaches every saved card and bank account. */
export const deleteCustomer = (id: string) => call("DELETE", `/customers/${encodeURIComponent(id)}`);
export const detachPaymentMethod = (id: string) => call("POST", `/payment_methods/${encodeURIComponent(id)}/detach`);
export const setDefaultPaymentMethod = (customer: string, paymentMethod: string) =>
  call("POST", `/customers/${encodeURIComponent(customer)}`, { invoice_settings: { default_payment_method: paymentMethod } });

/** Verifies a Stripe-Signature header against the raw body (HMAC-SHA256, 5 minute tolerance). */
export function verifyStripeSignature(header: string | null, raw: string, secret: string, now = Date.now()): boolean {
  if (!header) return false;
  const parts = header.split(",").map(p => p.split("=") as [string, string]);
  const t = parts.find(([k]) => k === "t")?.[1];
  const signatures = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || !/^\d+$/.test(t) || !signatures.length) return false;
  if (Math.abs(now / 1000 - Number(t)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${raw}`).digest();
  return signatures.some(sig => {
    const given = Buffer.from(sig, "hex");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
