import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ query: vi.fn(async (..._args: unknown[]) => ({ rows: [] as unknown[], rowCount: 0 })) }));
vi.mock("@/lib/admin/db", () => ({ pool: db, transaction: async (run: (c: typeof db) => unknown) => run(db) }));

import { webActor } from "@/lib/pipeline/actor";
import { allow, clearedCookie, requireUser, register, sessionCookie, sessionUser, signIn, strictOrigin } from "@/lib/users/auth";
import { userRoute } from "@/lib/users/route";

const token = "a".repeat(64);
const req = (headers: Record<string, string> = {}, method = "POST", url = "http://localhost:3000/api/x") => new Request(url, { method, headers });

describe("user accounts: request hygiene", () => {
  beforeEach(() => { db.query.mockClear(); db.query.mockImplementation(async () => ({ rows: [], rowCount: 0 })); process.env.DATABASE_URL = "postgres://test"; delete process.env.APP_ORIGIN; });

  it("only accepts writes from this app's own origin", () => {
    expect(() => strictOrigin(req({ origin: "http://localhost:3000" }))).not.toThrow();
    expect(() => strictOrigin(req({ origin: "https://evil.example" }))).toThrow(/INVALID_ORIGIN/);
    expect(() => strictOrigin(req({}))).toThrow(/INVALID_ORIGIN/);                       // no Origin and not a same-origin fetch
    expect(() => strictOrigin(req({ "sec-fetch-site": "cross-site" }))).toThrow(/INVALID_ORIGIN/);
    expect(() => strictOrigin(req({ "sec-fetch-site": "same-origin" }))).not.toThrow();
    process.env.APP_ORIGIN = "https://az.example.com";
    expect(() => strictOrigin(req({ origin: "http://localhost:3000" }))).toThrow(/INVALID_ORIGIN/);
  });

  it("issues HttpOnly, SameSite session cookies, Secure on https", () => {
    expect(sessionCookie(token)).toMatch(/^az_user=a{64}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=1209600$/);
    process.env.APP_ORIGIN = "https://az.example.com";
    expect(sessionCookie(token)).toMatch(/; Secure$/);
    expect(clearedCookie()).toMatch(/Max-Age=0; Secure$/);
  });

  it("treats a missing, malformed or unknown session cookie as signed out without touching user data", async () => {
    expect(await sessionUser(req({}))).toBeNull();
    expect(await sessionUser(req({ cookie: "az_user=../../etc" }))).toBeNull();
    expect(db.query).not.toHaveBeenCalled();
    expect(await sessionUser(req({ cookie: `az_user=${token}` }))).toBeNull();           // well-formed but not in the table
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it("resolves a valid session and looks the token up only by its hash", async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: "u1", name: "Ada", email: "ada@example.com", verified: true }], rowCount: 1 });
    expect(await sessionUser(req({ cookie: `x=1; az_user=${token}` }))).toEqual({ id: "u1", name: "Ada", email: "ada@example.com", verified: true });
    const [, params] = db.query.mock.calls[0] as [string, string[]];
    expect(params[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(params[0]).not.toBe(token);                                                    // the raw token is never sent to the database
  });

  it("answers 401 to guests and checks the origin before anything else on writes", async () => {
    await expect(requireUser(req({ origin: "http://localhost:3000" }), true)).rejects.toMatchObject({ status: 401, code: "SIGN_IN_REQUIRED" });
    await expect(requireUser(req({ origin: "https://evil.example", cookie: `az_user=${token}` }), true)).rejects.toMatchObject({ status: 403, code: "INVALID_ORIGIN" });
    const res = await userRoute(req({}, "GET"), false, async () => ({ secret: 1 }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "SIGN_IN_REQUIRED" });
  });

  it("rate limits with a per-minute window", async () => {
    db.query.mockResolvedValueOnce({ rows: [{ hits: 5 }], rowCount: 1 }).mockResolvedValueOnce({ rows: [{ hits: 6 }], rowCount: 1 });
    expect(await allow("register", "ip", 5)).toBe(true);
    expect(await allow("register", "ip", 5)).toBe(false);
  });

  it("rejects weak passwords and bad origins at registration, and unknown emails at sign-in identically to wrong passwords", async () => {
    db.query.mockResolvedValue({ rows: [{ hits: 1 }], rowCount: 1 });
    await expect(register(req({ origin: "http://localhost:3000" }), { name: "Ada", email: "ada@example.com", password: "short" })).rejects.toMatchObject({ code: "WEAK_PASSWORD" });
    await expect(register(req({ origin: "https://evil.example" }), { name: "Ada", email: "ada@example.com", password: "a-long-enough-pass" })).rejects.toMatchObject({ code: "INVALID_ORIGIN" });
    db.query.mockResolvedValueOnce({ rows: [{ hits: 1 }], rowCount: 1 }).mockResolvedValueOnce({ rows: [{ hits: 1 }], rowCount: 1 }).mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(signIn(req({ origin: "http://localhost:3000" }), { email: "nobody@example.com", password: "whatever-password" })).rejects.toMatchObject({ status: 401, code: "INVALID_CREDENTIALS" });
  });
});

describe("web actors", () => {
  it("makes everyone without a session a guest, even on localhost", () => {
    const guest = webActor(req({ host: "localhost:3000" }, "POST"), null).actor;
    expect(guest).toMatchObject({ local: false, userId: null, meta: { role: "guest", authenticated: false } });
    expect([...guest.execution.permissions]).toEqual(["tools:calculator"]);
  });
  it("gives a signed-in user their account id and the signed-in permissions", () => {
    const user = webActor(req({}), { id: "u1", name: "Ada", email: "ada@example.com", verified: true }).actor;
    expect(user).toMatchObject({ local: true, userId: "u1", auth: { userId: "u1" }, meta: { role: "user", authenticated: true } });
    expect(user.execution.permissions.has("tools:search")).toBe(true);
  });
});
