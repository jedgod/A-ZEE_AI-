import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ query: vi.fn(async (..._args: unknown[]) => ({ rows: [] as any[], rowCount: 0 })) }));
vi.mock("@/lib/admin/db", () => ({ pool: db, transaction: async (run: (c: typeof db) => unknown) => run(db) }));
const plans = vi.hoisted(() => ({
  listPlans: vi.fn(async () => [{ id: "plus", name: "Plus", price: 14.99, annualPrice: 149.9 }, { id: "free", name: "Free", price: 0, annualPrice: null }]),
  regionFrom: vi.fn(() => null),
  subscribe: vi.fn(async () => ({ status: "pending", planId: "plus", price: 14.99, billing: "monthly" })),
}));
vi.mock("@/lib/plans", () => plans);
const billing = vi.hoisted(() => ({ applyBillingEvent: vi.fn(async (..._a: unknown[]) => true) }));
vi.mock("@/lib/billing", () => billing);

import { checkout, cronAuthorized, handleCheckoutEvent, renewDue } from "@/lib/payments/checkout";

const user = { id: "u1", name: "Ada", email: "ada@example.com", verified: true };
const fetchMock = vi.fn();
const limited = { rows: [{ hits: 1 }], rowCount: 1 };
const method = { rows: [{ pm: "pm_abcdefgh1234", customer: "cus_1" }], rowCount: 1 };

function sql(overrides: Record<string, any> = {}) {
  db.query.mockImplementation(async (text: unknown) => {
    const t = String(text);
    if (t.includes("admin_rate_limits")) return limited;
    const key = Object.keys(overrides).find(k => t.includes(k));
    if (key) return overrides[key];
    if (t.includes("FROM payment_methods pm")) return method;
    if (t.includes("FROM subscriptions WHERE user_id") && t.includes("status = 'pending'")) return { rows: [{ id: "sub1" }], rowCount: 1 };
    if (t.includes("FROM subscriptions WHERE id")) return { rows: [{ id: "sub1", current_period_end: null }], rowCount: 1 };
    if (t.includes("FROM payments WHERE user_id")) return { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 1 };
  });
}
const stripe = (body: unknown, status = 200) => fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));
const intent = (over: Record<string, unknown> = {}) => ({ id: "pi_1", status: "succeeded", customer: "cus_1", amount: 1499, amount_received: 1499, currency: "usd", metadata: { user_id: "u1", plan_id: "plus", billing: "monthly", subscription_id: "sub1", kind: "signup" }, ...over });

describe("checkout", () => {
  beforeEach(() => {
    db.query.mockReset(); fetchMock.mockReset(); billing.applyBillingEvent.mockClear(); plans.subscribe.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    process.env.STRIPE_SECRET_KEY = "sk_test_x"; process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_x";
    sql();
  });

  it("charges the server-side price and activates once Stripe says it succeeded", async () => {
    stripe(intent());
    const result = await checkout(user, { planId: "plus", billing: "monthly", expectedPrice: 14.99 }, new Headers());
    expect(result).toEqual({ status: "active", planId: "plus" });
    const sent = new URLSearchParams(String(fetchMock.mock.calls[0][1].body));
    expect(sent.get("amount")).toBe("1499");
    expect(sent.get("off_session")).toBe("true");
    expect(sent.get("customer")).toBe("cus_1");
    expect(fetchMock.mock.calls[0][1].headers["Idempotency-Key"]).toBe("signup-sub1");
    expect(billing.applyBillingEvent).toHaveBeenCalledTimes(1);
    const event = billing.applyBillingEvent.mock.calls[0][0] as any;
    expect(event).toMatchObject({ id: "stripe:pi_1", type: "subscription.activated", data: { accountId: "u1", planId: "plus", pricePaid: 14.99, provider: "stripe" } });
  });

  it("refuses when the price the user saw is not the price on the server", async () => {
    expect(await checkout(user, { planId: "plus", billing: "monthly", expectedPrice: 1 }, new Headers())).toEqual({ status: "price_changed", price: 14.99 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(plans.subscribe).not.toHaveBeenCalled();
  });

  it("never honors a self-declared region and rejects free or unknown plans", async () => {
    await expect(checkout(user, { planId: "free" }, new Headers())).rejects.toMatchObject({ code: "NOT_A_PAID_PLAN" });
    await expect(checkout(user, { planId: "nope" }, new Headers())).rejects.toMatchObject({ code: "NOT_A_PAID_PLAN" });
    expect(plans.regionFrom).toHaveBeenCalledWith(expect.anything(), null);
  });

  it("asks for a payment method when none is saved, without touching Stripe", async () => {
    sql({ "FROM payment_methods pm": { rows: [], rowCount: 0 } });
    expect(await checkout(user, { planId: "plus" }, new Headers())).toEqual({ status: "payment_method_required" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not charge again while a charge for the same plan is settling or just succeeded", async () => {
    sql({ "FROM payments WHERE user_id": { rows: [{ status: "processing" }], rowCount: 1 } });
    expect(await checkout(user, { planId: "plus" }, new Headers())).toEqual({ status: "processing", planId: "plus" });
    sql({ "FROM payments WHERE user_id": { rows: [{ status: "succeeded" }], rowCount: 1 } });
    expect(await checkout(user, { planId: "plus" }, new Headers())).toEqual({ status: "active", planId: "plus" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports declines with a safe code and never activates", async () => {
    stripe({ error: { code: "card_declined", message: "Your card 4242 was declined", payment_intent: { id: "pi_x" } } }, 402);
    const result = await checkout(user, { planId: "plus" }, new Headers());
    expect(result).toEqual({ status: "failed", code: "card_declined" });
    expect(billing.applyBillingEvent).not.toHaveBeenCalled();
  });

  it("leaves a bank debit pending until the webhook confirms it", async () => {
    stripe(intent({ status: "processing" }));
    expect(await checkout(user, { planId: "plus" }, new Headers())).toEqual({ status: "processing", planId: "plus" });
    expect(billing.applyBillingEvent).not.toHaveBeenCalled();
  });
});

describe("webhook and renewals", () => {
  beforeEach(() => { db.query.mockReset(); fetchMock.mockReset(); billing.applyBillingEvent.mockClear(); vi.stubGlobal("fetch", fetchMock); process.env.STRIPE_SECRET_KEY = "sk_test_x"; process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_x"; sql(); });

  it("activates from payment_intent.succeeded only when the charge is on the user's own customer", async () => {
    const event = { id: "evt_1", type: "payment_intent.succeeded", data: { object: intent() } };
    sql({ "FROM payment_customers": { rows: [], rowCount: 0 } });
    await handleCheckoutEvent(event);
    expect(billing.applyBillingEvent).not.toHaveBeenCalled();
    sql({ "FROM payment_customers": { rows: [{ "?column?": 1 }], rowCount: 1 } });
    await handleCheckoutEvent(event);
    expect(billing.applyBillingEvent).toHaveBeenCalledTimes(1);
  });

  it("ignores charges that aren't ours", async () => {
    await handleCheckoutEvent({ id: "evt_2", type: "payment_intent.succeeded", data: { object: { id: "pi_other", metadata: {} } } });
    expect(billing.applyBillingEvent).not.toHaveBeenCalled();
  });

  it("marks a failed renewal past due", async () => {
    sql({ "FROM payment_customers": { rows: [{}], rowCount: 1 } });
    await handleCheckoutEvent({ id: "evt_3", type: "payment_intent.payment_failed", data: { object: intent({ status: "requires_payment_method", metadata: { user_id: "u1", plan_id: "plus", billing: "monthly", subscription_id: "sub1", kind: "renewal" }, last_payment_error: { code: "card_declined" } }) } });
    expect(billing.applyBillingEvent.mock.calls[0][0]).toMatchObject({ type: "subscription.past_due", data: { providerSubscriptionId: "az:sub1" } });
  });

  it("only lets the scheduler in with the long shared secret", () => {
    process.env.BILLING_CRON_SECRET = "x".repeat(40);
    expect(cronAuthorized(`Bearer ${"x".repeat(40)}`)).toBe(true);
    expect(cronAuthorized(`Bearer ${"y".repeat(40)}`)).toBe(false);
    expect(cronAuthorized(null)).toBe(false);
    process.env.BILLING_CRON_SECRET = "short";
    expect(cronAuthorized("Bearer short")).toBe(false);
  });

  it("renews due subscriptions, ends cancelled ones, and marks failures past due", async () => {
    const due = (id: string, cancel = false) => ({ id, user_id: "u1", plan_id: "plus", billing: "monthly", price_paid: "14.99", current_period_end: new Date("2026-11-01T00:00:00Z"), cancel_at_period_end: cancel });
    sql({ "FROM subscriptions\n     WHERE status = 'active'": { rows: [due("s_ok"), due("s_cancel", true), due("s_fail")], rowCount: 3 } });
    let n = 0;
    fetchMock.mockImplementation(async () => { n++; return n === 1 ? new Response(JSON.stringify(intent({ id: "pi_r1", metadata: { user_id: "u1", plan_id: "plus", billing: "monthly", subscription_id: "s_ok", kind: "renewal" } })), { status: 200 }) : new Response(JSON.stringify({ error: { code: "card_declined" } }), { status: 402 }); });
    const out = await renewDue();
    expect(out).toEqual({ renewed: 1, processing: 0, failed: 1, canceled: 1 });
    const types = billing.applyBillingEvent.mock.calls.map(c => (c[0] as any).type);
    expect(types).toEqual(expect.arrayContaining(["subscription.updated", "subscription.canceled", "subscription.past_due"]));
    expect(fetchMock.mock.calls[0][1].headers["Idempotency-Key"]).toMatch(/^renew-s_ok-\d+$/);
  });
});
