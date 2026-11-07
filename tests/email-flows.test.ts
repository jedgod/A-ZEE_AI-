import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ query: vi.fn(async (..._args: unknown[]) => ({ rows: [] as any[], rowCount: 0 })) }));
vi.mock("@/lib/admin/db", () => ({ pool: db, transaction: async (run: (c: typeof db) => unknown) => run(db) }));

import { assertMailReady, sendMail } from "@/lib/users/mail";
import { forgotPassword, resetPassword, verifyEmail } from "@/lib/users/security";
import { consumeToken, createToken } from "@/lib/users/tokens";

const same = { origin: "http://localhost:3000" };
const post = (headers: Record<string, string> = same) => new Request("http://localhost:3000/api/auth/x", { method: "POST", headers });
const limited = (hits: number) => ({ rows: [{ hits }], rowCount: 1 });
const env = process.env as Record<string, string | undefined>;
const nodeEnv = env.NODE_ENV;

describe("email tokens", () => {
  beforeEach(() => { db.query.mockReset(); db.query.mockResolvedValue({ rows: [], rowCount: 0 }); });

  it("emails a random token and stores only its hash", async () => {
    const token = await createToken(db as never, "u1", "verify");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const insert = db.query.mock.calls.find(c => String(c[0]).startsWith("INSERT INTO user_email_tokens"))!;
    const params = insert[1] as string[];
    expect(params[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(params).not.toContain(token);
    expect(db.query.mock.calls[0][0]).toMatch(/DELETE FROM user_email_tokens/); // a new link cancels the old unused one
  });

  it("only spends well-formed, unused, unexpired tokens, once", async () => {
    expect(await consumeToken(db as never, "short", "reset")).toBeNull();
    expect(db.query).not.toHaveBeenCalled();
    db.query.mockResolvedValueOnce({ rows: [{ user_id: "u1" }], rowCount: 1 });
    expect(await consumeToken(db as never, "A".repeat(43), "reset")).toBe("u1");
    expect(String(db.query.mock.calls[0][0])).toMatch(/used_at IS NULL AND expires_at > now\(\)/);
    expect(await consumeToken(db as never, "A".repeat(43), "reset")).toBeNull();
  });
});

describe("mail", () => {
  it("prints to the console in development and refuses to register without a provider in production", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    delete env.RESEND_API_KEY; delete env.MAIL_FROM;
    env.NODE_ENV = "development";
    await sendMail("a@b.co", "Hi", "link");
    expect(info).toHaveBeenCalled();
    env.NODE_ENV = "production";
    expect(() => assertMailReady()).toThrow(/EMAIL_NOT_CONFIGURED/);
    await expect(sendMail("a@b.co", "Hi", "link")).rejects.toThrow(/EMAIL_NOT_CONFIGURED/);
    env.NODE_ENV = nodeEnv ?? "test";
    info.mockRestore();
  });
});

describe("verify, forgot and reset", () => {
  beforeEach(() => { db.query.mockReset(); db.query.mockResolvedValue(limited(1)); delete env.APP_ORIGIN; });

  it("rejects cross-origin posts and bad links", async () => {
    await expect(verifyEmail(post({ origin: "https://evil.example" }), { token: "x" })).rejects.toMatchObject({ code: "INVALID_ORIGIN" });
    db.query.mockResolvedValueOnce(limited(1)).mockResolvedValue({ rows: [], rowCount: 0 });
    await expect(verifyEmail(post(), { token: "A".repeat(43) })).rejects.toMatchObject({ status: 400, code: "INVALID_OR_EXPIRED_LINK" });
  });

  it("answers the same for an unknown email and sends nothing", async () => {
    db.query.mockResolvedValueOnce(limited(1)).mockResolvedValueOnce(limited(1)).mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(forgotPassword(post(), { email: "nobody@example.com" })).resolves.toBeUndefined();
    expect(db.query.mock.calls.some(c => String(c[0]).startsWith("INSERT INTO user_email_tokens"))).toBe(false);
  });

  it("refuses weak new passwords before spending the token", async () => {
    db.query.mockResolvedValue(limited(1));
    await expect(resetPassword(post(), { token: "A".repeat(43), password: "short" })).rejects.toMatchObject({ code: "WEAK_PASSWORD" });
    expect(db.query.mock.calls.some(c => String(c[0]).includes("user_email_tokens"))).toBe(false);
  });

  it("resets: spends the token, sets the hash, marks verified and revokes every session", async () => {
    db.query.mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (text.includes("INSERT INTO admin_rate_limits")) return limited(1);
      if (text.includes("UPDATE user_email_tokens")) return { rows: [{ user_id: "u1" }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    await resetPassword(post(), { token: "A".repeat(43), password: "a-long-enough-new-pass" });
    const sql = db.query.mock.calls.map(c => String(c[0]));
    expect(sql.some(s => s.includes("UPDATE user_credentials SET password_hash"))).toBe(true);
    expect(sql.some(s => s.includes("email_verified_at = coalesce"))).toBe(true);
    expect(sql.some(s => s.includes("UPDATE user_sessions SET revoked_at"))).toBe(true);
    const hash = db.query.mock.calls.find(c => String(c[0]).includes("SET password_hash"))![1] as string[];
    expect(hash[1]).toMatch(/^scrypt\$/);
  });
});
