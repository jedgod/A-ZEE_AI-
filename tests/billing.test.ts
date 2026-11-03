import { describe, expect, it } from "vitest";
import { eventSchema, sign, TOLERANCE_SECONDS, verifySignature } from "@/lib/billing";

const secret = "s".repeat(40);
const body = JSON.stringify({ id: "evt_1", type: "subscription.activated", data: {} });

describe("billing webhook signature", () => {
  it("accepts a correct, fresh signature", () => {
    const t = Math.floor(Date.now() / 1000);
    expect(verifySignature(`t=${t},v1=${sign(secret, t, body)}`, body, secret)).toBe(true);
  });

  it("rejects tampering, wrong secrets, malformed headers, and replays", () => {
    const t = Math.floor(Date.now() / 1000);
    const good = sign(secret, t, body);
    expect(verifySignature(`t=${t},v1=${good}`, body + " ", secret)).toBe(false);
    expect(verifySignature(`t=${t},v1=${good}`, body, "x".repeat(40))).toBe(false);
    expect(verifySignature(`t=${t + 1},v1=${good}`, body, secret)).toBe(false);
    expect(verifySignature(null, body, secret)).toBe(false);
    expect(verifySignature(`v1=${good}`, body, secret)).toBe(false);
    const old = t - TOLERANCE_SECONDS - 5;
    expect(verifySignature(`t=${old},v1=${sign(secret, old, body)}`, body, secret)).toBe(false);
  });
});

describe("billing events", () => {
  const base = { id: "evt_1", type: "subscription.activated", data: { email: "a@b.co", planId: "plus", providerSubscriptionId: "sub_1" } };

  it("requires an account reference and a known event type", () => {
    expect(eventSchema.parse(base).data.planId).toBe("plus");
    expect(() => eventSchema.parse({ ...base, type: "invoice.paid" })).toThrow();
    expect(() => eventSchema.parse({ ...base, data: { planId: "plus", providerSubscriptionId: "sub_1" } })).toThrow(/accountId or email/);
    expect(() => eventSchema.parse({ ...base, data: { ...base.data, planId: "../x" } })).toThrow();
    expect(() => eventSchema.parse({ ...base, extra: true })).toThrow();
  });
});
