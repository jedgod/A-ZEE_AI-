import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ query: vi.fn(async (..._args: unknown[]) => ({ rows: [] as any[], rowCount: 0 })) }));
vi.mock("@/lib/admin/db", () => ({ pool: db, transaction: async (run: (c: typeof db) => unknown) => run(db) }));

import { encode, verifyStripeSignature } from "@/lib/payments/stripe";
import { finishSetup, handleStripeEvent, startSetup, syncMethod } from "@/lib/payments/methods";

const user = { id: "u1", name: "Ada", email: "ada@example.com", verified: true };
const limited = { rows: [{ hits: 1 }], rowCount: 1 };
const fetchMock = vi.fn();

function stripeReturns(map: Record<string, unknown>) {
  fetchMock.mockImplementation(async (url: string) => {
    const hit = Object.entries(map).find(([path]) => String(url).includes(path));
    return new Response(JSON.stringify(hit ? hit[1] : { error: { code: "resource_missing" } }), { status: hit ? 200 : 404 });
  });
}
function sql(handlers: Record<string, any>) {
  db.query.mockImplementation(async (text: unknown) => {
    const t = String(text);
    if (t.includes("admin_rate_limits")) return limited;
    const key = Object.keys(handlers).find(k => t.includes(k));
    return key ? handlers[key] : { rows: [], rowCount: 0 };
  });
}

describe("payment methods", () => {
  beforeEach(() => {
    db.query.mockReset(); fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock);
    process.env.STRIPE_SECRET_KEY = "sk_test_x"; process.env.STRIPE_PUBLISHABLE_KEY = "pk_test_x";
  });

  it("encodes nested Stripe parameters", () => {
    expect(encode({ customer: "cus_1", payment_method_types: ["card"], metadata: { user_id: "u1" }, skip: undefined }).toString())
      .toBe("customer=cus_1&payment_method_types%5B0%5D=card&metadata%5Buser_id%5D=u1");
  });

  it("verifies webhook signatures, rejecting forged, stale and malformed ones", () => {
    const secret = "whsec_test", body = '{"id":"evt_1"}', now = Date.UTC(2026, 10, 7), t = Math.floor(now / 1000);
    const good = `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
    expect(verifyStripeSignature(good, body, secret, now)).toBe(true);
    expect(verifyStripeSignature(good, body + " ", secret, now)).toBe(false);                 // body changed
    expect(verifyStripeSignature(good, body, "whsec_other", now)).toBe(false);               // wrong secret
    expect(verifyStripeSignature(good, body, secret, now + 10 * 60_000)).toBe(false);        // replayed later
    expect(verifyStripeSignature(null, body, secret, now)).toBe(false);
    expect(verifyStripeSignature(`t=${t},v1=zz`, body, secret, now)).toBe(false);
  });

  it("is unavailable until Stripe is configured", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    await expect(startSetup(user, { kind: "card" })).rejects.toMatchObject({ status: 503, code: "PAYMENTS_NOT_CONFIGURED" });
  });

  it("starts a setup with only a client secret and the publishable key", async () => {
    sql({ "FROM payment_customers": { rows: [{ provider_customer_id: "cus_1" }], rowCount: 1 }, "count(*)": { rows: [{ n: 0 }], rowCount: 1 } });
    stripeReturns({ "/setup_intents": { client_secret: "seti_1_secret_abc" } });
    const result = await startSetup(user, { kind: "bank_account" });
    expect(result).toEqual({ clientSecret: "seti_1_secret_abc", publishableKey: "pk_test_x" });
    const sent = String(fetchMock.mock.calls[0][1].body);
    expect(sent).toContain("us_bank_account");
    expect(sent).not.toContain("sk_test");
    await expect(startSetup(user, { kind: "gift_card" })).rejects.toBeTruthy();
  });

  it("saves card details as Stripe reports them and refuses a token owned by someone else", async () => {
    sql({ "FROM payment_customers": { rows: [{ provider_customer_id: "cus_1" }], rowCount: 1 }, "INSERT INTO payment_methods": { rows: [{ id: "m1", kind: "card", brand: "visa", funding: "debit", account_type: null, last4: "4242", exp_month: 4, exp_year: 2030, is_default: true, created_at: new Date() }], rowCount: 1 }, "count(*)": { rows: [{ n: 0 }], rowCount: 1 } });
    stripeReturns({ "/payment_methods/pm_abcdefgh1234": { id: "pm_abcdefgh1234", type: "card", customer: "cus_1", card: { brand: "visa", last4: "4242", exp_month: 4, exp_year: 2030, funding: "debit" } }, "/customers/cus_1": {} });
    const saved = await syncMethod("u1", "pm_abcdefgh1234", false);
    expect(saved).toMatchObject({ kind: "card", brand: "visa", funding: "debit", last4: "4242", isDefault: true });
    expect(JSON.stringify(saved)).not.toMatch(/pm_|cus_|sk_/);                               // no provider ids reach the browser

    stripeReturns({ "/payment_methods/pm_abcdefgh1234": { id: "pm_abcdefgh1234", type: "card", customer: "cus_SOMEONE_ELSE", card: { brand: "visa", last4: "4242", exp_month: 4, exp_year: 2030 } } });
    await expect(syncMethod("u1", "pm_abcdefgh1234", false)).rejects.toMatchObject({ status: 403, code: "PAYMENT_METHOD_NOT_YOURS" });
    await expect(syncMethod("u1", "not-a-token", false)).rejects.toBeTruthy();
  });

  it("records bank accounts with checking or savings", async () => {
    let params: unknown[] = [];
    db.query.mockImplementation(async (text: unknown, p?: unknown) => {
      const t = String(text);
      if (t.includes("admin_rate_limits")) return limited;
      if (t.includes("FROM payment_customers")) return { rows: [{ provider_customer_id: "cus_1" }], rowCount: 1 };
      if (t.includes("count(*)")) return { rows: [{ n: 0 }], rowCount: 1 };
      if (t.includes("INSERT INTO payment_methods")) { params = p as unknown[]; return { rows: [{ id: "m2", kind: "bank_account", brand: "Test Bank", funding: null, account_type: "savings", last4: "6789", exp_month: null, exp_year: null, is_default: false, created_at: new Date() }], rowCount: 1 }; }
      return { rows: [], rowCount: 0 };
    });
    stripeReturns({ "/payment_methods/pm_bankbank1234": { id: "pm_bankbank1234", type: "us_bank_account", customer: "cus_1", us_bank_account: { bank_name: "Test Bank", last4: "6789", account_type: "savings" } } });
    const saved = await syncMethod("u1", "pm_bankbank1234", false);
    expect(saved).toMatchObject({ kind: "bank_account", accountType: "savings", last4: "6789" });
    expect(params.slice(2, 8)).toEqual(["bank_account", "Test Bank", null, "savings", "6789", null]);
  });

  it("only finishes a setup that belongs to this user's customer", async () => {
    sql({ "FROM payment_customers": { rows: [{ provider_customer_id: "cus_1" }], rowCount: 1 } });
    stripeReturns({ "/setup_intents/seti_abcdefgh1234": { id: "seti_abcdefgh1234", status: "succeeded", customer: "cus_OTHER", payment_method: "pm_abcdefgh1234" } });
    await expect(finishSetup(user, { setupIntentId: "seti_abcdefgh1234" })).rejects.toMatchObject({ code: "PAYMENT_METHOD_NOT_YOURS" });
    stripeReturns({ "/setup_intents/seti_abcdefgh1234": { id: "seti_abcdefgh1234", status: "requires_action", customer: "cus_1", payment_method: "pm_abcdefgh1234" } });
    await expect(finishSetup(user, { setupIntentId: "seti_abcdefgh1234" })).resolves.toEqual({ pending: true, method: null });
  });

  it("removes a method locally when Stripe reports it detached", async () => {
    sql({ "DELETE FROM payment_methods": { rows: [{ user_id: "u1", is_default: false }], rowCount: 1 } });
    await handleStripeEvent({ id: "evt_1", type: "payment_method.detached", data: { object: { id: "pm_abcdefgh1234" } } });
    expect(db.query.mock.calls.some(c => String(c[0]).startsWith("DELETE FROM payment_methods"))).toBe(true);
  });
});
