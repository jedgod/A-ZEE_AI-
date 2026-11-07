import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ query: vi.fn(async (..._args: unknown[]) => ({ rows: [] as any[], rowCount: 0 })) }));
vi.mock("@/lib/admin/db", () => ({ pool: db, transaction: async (run: (c: typeof db) => unknown) => run(db) }));

import { deviceCookie } from "@/lib/abuse/signals";
import { hashPassword } from "@/lib/staff/password";
import { MOBILE_SESSION_DAYS, sessionUser, signIn, strictOrigin } from "@/lib/users/auth";
import { deleteAccount } from "@/lib/users/deletion";
import { changePassword } from "@/lib/users/security";

const env = process.env as Record<string, string | undefined>;
const token = "a".repeat(64);
const req = (headers: Record<string, string> = {}, method = "POST") => new Request("http://localhost:3000/api/x", { method, headers });
const limited = { rows: [{ hits: 1 }], rowCount: 1 };
const fetchMock = vi.fn();

describe("mobile client sessions", () => {
  beforeEach(() => { db.query.mockReset(); db.query.mockResolvedValue({ rows: [], rowCount: 0 }); env.DATABASE_URL = "postgres://test"; delete env.APP_ORIGIN; });

  it("lets the app write without an Origin header, but never a browser", () => {
    expect(() => strictOrigin(req({ "x-az-client": "mobile" }))).not.toThrow();
    expect(() => strictOrigin(req({}))).toThrow(/INVALID_ORIGIN/);                                      // a plain request still needs an origin
    expect(() => strictOrigin(req({ "x-az-client": "mobile", origin: "https://evil.example" }))).toThrow(/INVALID_ORIGIN/); // a web page can't claim to be the app
    expect(() => strictOrigin(req({ "x-az-client": "web" }))).toThrow(/INVALID_ORIGIN/);
  });

  it("accepts a Bearer token as the session, and only a well-formed one", async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: "u1", name: "Ada", email: "ada@example.com", verified: true }], rowCount: 1 });
    expect(await sessionUser(req({ authorization: `Bearer ${token}` }, "GET"))).toMatchObject({ id: "u1" });
    expect((db.query.mock.calls[0][1] as string[])[0]).toMatch(/^[a-f0-9]{64}$/);
    expect((db.query.mock.calls[0][1] as string[])[0]).not.toBe(token);                                  // only the hash is looked up
    db.query.mockClear();
    expect(await sessionUser(req({ authorization: "Bearer not-a-token" }, "GET"))).toBeNull();
    expect(await sessionUser(req({ authorization: `Basic ${token}` }, "GET"))).toBeNull();
    expect(db.query).not.toHaveBeenCalled();
  });

  it("gives the app a longer-lived session than the browser", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");
    db.query.mockImplementation(async (sql: unknown) => {
      const t = String(sql);
      if (t.includes("admin_rate_limits")) return limited;
      if (t.includes("FROM users u JOIN user_credentials")) return { rows: [{ id: "u1", name: "Ada", email: "ada@example.com", verified: true, password_hash: hash, failed_attempts: 0, locked: false }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    await signIn(req({ "x-az-client": "mobile" }), { email: "ada@example.com", password: "correct-horse-battery-staple" });
    const insert = db.query.mock.calls.find(c => String(c[0]).startsWith("INSERT INTO user_sessions"))!;
    expect((insert[1] as unknown[])[2]).toBe(MOBILE_SESSION_DAYS);
    db.query.mockClear();
    await signIn(req({ origin: "http://localhost:3000" }), { email: "ada@example.com", password: "correct-horse-battery-staple" });
    expect((db.query.mock.calls.find(c => String(c[0]).startsWith("INSERT INTO user_sessions"))![1] as unknown[])[2]).toBe(14);
  });

  it("changing the password signs out the other devices but keeps the app's own Bearer session", async () => {
    const hash = await hashPassword("correct-horse-battery-staple");
    db.query.mockImplementation(async (sql: unknown) => {
      const t = String(sql);
      if (t.includes("admin_rate_limits")) return limited;
      if (t.includes("FROM user_sessions s JOIN users u")) return { rows: [{ id: "u1", name: "Ada", email: "ada@example.com", verified: true }], rowCount: 1 };
      if (t.includes("SELECT password_hash FROM user_credentials")) return { rows: [{ password_hash: hash }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    await changePassword(req({ authorization: `Bearer ${token}`, "x-az-client": "mobile" }), { current: "correct-horse-battery-staple", next: "a-different-long-password-1" });
    const revoke = db.query.mock.calls.find(c => String(c[0]).startsWith("UPDATE user_sessions SET revoked_at"))!;
    const except = (revoke[1] as unknown[])[1] as string;
    expect(except).toMatch(/^[a-f0-9]{64}$/);                                                           // the current session is excluded from the revoke
    expect(except).not.toBe(token);                                                                      // identified by its hash
  });

  it("uses the app's install id as its device id, only for the app and only when well-formed", () => {
    const id = "b".repeat(32);
    expect(deviceCookie(req({ "x-az-client": "mobile", "x-az-device": id }))).toEqual({ id, setCookie: null });
    expect(deviceCookie(req({ "x-az-device": id })).id).not.toBe(id);                                    // a browser can't pick its own
    expect(deviceCookie(req({ "x-az-client": "mobile", "x-az-device": "'; DROP TABLE x;--" })).id).not.toBe("'; DROP TABLE x;--");
  });
});

describe("account deletion", () => {
  const signedIn = { authorization: `Bearer ${token}`, "x-az-client": "mobile" };
  let hash: string;
  const calls = () => db.query.mock.calls.map(c => String(c[0]));

  beforeEach(async () => {
    hash = await hashPassword("correct-horse-battery-staple");
    db.query.mockReset(); fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock);
    env.DATABASE_URL = "postgres://test"; env.STRIPE_SECRET_KEY = "sk_test_x"; env.STRIPE_PUBLISHABLE_KEY = "pk_test_x"; delete env.RESEND_API_KEY; delete env.MAIL_FROM;
    vi.spyOn(console, "info").mockImplementation(() => undefined);
  });
  const world = (over: { customer?: boolean; exhausted?: boolean } = {}) => db.query.mockImplementation(async (sql: unknown) => {
    const t = String(sql);
    if (t.includes("admin_rate_limits")) return limited;
    if (t.includes("FROM user_sessions s JOIN users u")) return { rows: [{ id: "u1", name: "Ada", email: "ada@example.com", verified: false }], rowCount: 1 };
    if (t.includes("SELECT password_hash FROM user_credentials")) return { rows: [{ password_hash: hash }], rowCount: 1 };
    if (t.includes("FROM payment_customers")) return over.customer ? { rows: [{ provider_customer_id: "cus_1" }], rowCount: 1 } : { rows: [], rowCount: 0 };
    if (t.includes("FROM free_quota_events WHERE user_id = $1 AND exhausted_at")) return over.exhausted ? { rows: [{}], rowCount: 1 } : { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 1 };
  });
  const body = { password: "correct-horse-battery-staple", confirm: "DELETE" };

  it("needs a signed-in user, the right password and the word DELETE", async () => {
    world();
    await expect(deleteAccount(req({ "x-az-client": "mobile" }), body)).rejects.toMatchObject({ status: 401 });
    await expect(deleteAccount(req(signedIn), { ...body, password: "wrong-password-123" })).rejects.toMatchObject({ code: "WRONG_PASSWORD" });
    await expect(deleteAccount(req(signedIn), { ...body, confirm: "yes" })).rejects.toBeTruthy();
    expect(calls().some(s => s.startsWith("DELETE FROM users"))).toBe(false);
  });

  it("works for an account that never verified its email", async () => {
    world();
    await deleteAccount(req(signedIn), body);                                                          // the session row above has verified: false
    expect(calls().some(s => s.startsWith("DELETE FROM users"))).toBe(true);
  });

  it("deletes the user's data, the device signals of an account that never used its free allowance, and the Stripe customer", async () => {
    world({ customer: true });
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "cus_1", deleted: true }), { status: 200 }));
    await deleteAccount(req(signedIn), body);
    const sql = calls();
    expect(fetchMock.mock.calls[0][0]).toContain("/customers/cus_1");
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
    for (const part of ["DELETE FROM device_signals", "DELETE FROM free_quota_events", "DELETE FROM operations_records", "DELETE FROM usage_counters", "DELETE FROM access_audit", "UPDATE complaints", "DELETE FROM users"]) {
      expect(sql.some(s => s.startsWith(part)), part).toBe(true);
    }
    expect(sql.findIndex(s => s.startsWith("DELETE FROM users"))).toBe(sql.length - 1 - sql.slice().reverse().findIndex(s => s.startsWith("DELETE FROM users")));
  });

  it("keeps only anonymous device facts when the account had used up its free allowance", async () => {
    world({ exhausted: true });
    await deleteAccount(req(signedIn), body);
    const sql = calls();
    const rekey = db.query.mock.calls.find(c => String(c[0]).startsWith("UPDATE device_signals SET user_id"))!;
    expect(String((rekey[1] as string[])[1])).toMatch(/^deleted:[0-9a-f-]{36}$/);
    expect(String(rekey[0])).toContain("user_agent = NULL");
    expect(sql.some(s => s.startsWith("DELETE FROM device_signals"))).toBe(false);
  });

  it("does not delete anything if Stripe fails to remove the saved payment methods", async () => {
    world({ customer: true });
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { code: "api_error" } }), { status: 500 }));
    await expect(deleteAccount(req(signedIn), body)).rejects.toMatchObject({ code: "PAYMENT_PROVIDER_ERROR" });
    expect(calls().some(s => s.startsWith("DELETE FROM users"))).toBe(false);
  });
});
