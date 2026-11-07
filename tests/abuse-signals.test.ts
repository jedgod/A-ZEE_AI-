import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ query: vi.fn(async (..._args: unknown[]) => ({ rows: [] as any[], rowCount: 0 })) }));
vi.mock("@/lib/admin/db", () => ({ pool: db, transaction: async (run: (c: typeof db) => unknown) => run(db) }));

import {
  clientIp, clientInfo, clusterLimit, deviceCookie, evaluateUser, fingerprintOf, flaggedCsv, isWalled, linkedFor, markQuotaExhausted, recordSignal, setAllowed, statusFor,
} from "@/lib/abuse/signals";

const env = process.env as Record<string, string | undefined>;
const req = (headers: Record<string, string> = {}) => new Request("http://localhost:3000/api/x", { method: "POST", headers });
const fp = "a".repeat(64);

describe("request signals", () => {
  beforeEach(() => { db.query.mockReset(); db.query.mockResolvedValue({ rows: [], rowCount: 0 }); delete env.TRUST_PROXY; delete env.FREE_CLUSTER_LIMIT; delete env.APP_ORIGIN; });

  it("only believes forwarding headers behind a trusted proxy, and only for real IPs", () => {
    expect(clientIp(req({ "x-forwarded-for": "9.9.9.9" }))).toBeNull();                   // spoofable when untrusted
    env.TRUST_PROXY = "true";
    expect(clientIp(req({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }))).toBe("9.9.9.9");
    expect(clientIp(req({ "cf-connecting-ip": "2001:db8::1", "x-forwarded-for": "9.9.9.9" }))).toBe("2001:db8::1");
    expect(clientIp(req({ "x-forwarded-for": "not-an-ip'; DROP TABLE users;--" }))).toBeNull();
  });

  it("classifies device types and trims the user agent", () => {
    expect(clientInfo(req({ "user-agent": "Mozilla/5.0 (iPhone) Mobile" })).deviceType).toBe("mobile");
    expect(clientInfo(req({ "user-agent": "Mozilla/5.0 (iPad)" })).deviceType).toBe("tablet");
    expect(clientInfo(req({ "user-agent": "x".repeat(900) })).userAgent).toHaveLength(300);
    expect(clientInfo(req({ "user-agent": "Mozilla/5.0 (Windows)" })).deviceType).toBe("desktop");
  });

  it("issues the device cookie itself and never accepts a malformed one", () => {
    const first = deviceCookie(req());
    expect(first.id).toMatch(/^[a-f0-9]{32}$/);
    expect(first.setCookie).toMatch(/^az_dev=[a-f0-9]{32}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+$/);
    expect(deviceCookie(req({ cookie: `az_dev=${first.id}` }))).toEqual({ id: first.id, setCookie: null });
    expect(deviceCookie(req({ cookie: "az_dev=' OR 1=1 --" })).setCookie).not.toBeNull();   // ignored, a fresh id is issued
    env.APP_ORIGIN = "https://az.example.com";
    expect(deviceCookie(req()).setCookie).toMatch(/; Secure$/);
  });

  it("keeps only well-formed fingerprints", () => {
    expect(fingerprintOf(fp)).toBe(fp);
    expect(fingerprintOf("short")).toBeNull();
    expect(fingerprintOf("Z".repeat(64))).toBeNull();
    expect(fingerprintOf(undefined)).toBeNull();
  });

  it("records a signal with parameterised values and skips repeat free-usage pings", async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: "s1" }], rowCount: 1 });
    expect(await recordSignal(req({ "user-agent": "UA" }), "u1", "signup", fp, "c".repeat(32))).toBe("s1");
    const [sql, params] = db.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/\$7/);
    expect(params).toEqual(["u1", null, "UA", "desktop", fp, "c".repeat(32), "signup"]);
    db.query.mockReset(); db.query.mockResolvedValueOnce({ rows: [{}], rowCount: 1 });
    expect(await recordSignal(req(), "u1", "free_usage", fp, "c".repeat(32))).toBeNull();
    expect(db.query).toHaveBeenCalledTimes(1);                                              // only the dedupe lookup ran
  });
});

describe("linking and the wall", () => {
  beforeEach(() => { db.query.mockReset(); db.query.mockResolvedValue({ rows: [], rowCount: 0 }); delete env.FREE_CLUSTER_LIMIT; });

  it("links only by device cookie, or fingerprint together with the network prefix; never by IP alone", async () => {
    db.query.mockResolvedValueOnce({ rows: [{ user_id: "u2", by_cookie: true, by_fingerprint: false, exhausted: true }, { user_id: "u3", by_cookie: false, by_fingerprint: true, exhausted: false }], rowCount: 2 });
    const links = await linkedFor("u1");
    expect(links).toEqual([
      { userId: "u2", reasons: ["device cookie"], exhausted: true },
      { userId: "u3", reasons: ["fingerprint and network"], exhausted: false },
    ]);
    const sql = String(db.query.mock.calls[0][0]);
    expect(sql).toMatch(/o\.cookie_id = m\.cookie_id OR \(o\.fingerprint = m\.fingerprint AND o\.prefix = m\.prefix\)/);
    expect(sql).not.toMatch(/ip_address = /);                                               // no raw-IP equality anywhere
  });

  it("walls an account only once enough linked accounts used up their free allowance", async () => {
    const links = (n: number) => ({ rows: Array.from({ length: n }, (_, i) => ({ user_id: `o${i}`, by_cookie: true, by_fingerprint: false, exhausted: true })), rowCount: n });
    db.query.mockResolvedValueOnce(links(1)).mockResolvedValueOnce({ rows: [{ walled: false }], rowCount: 1 });
    expect(await evaluateUser("u1")).toEqual({ walled: false, linked: 1, exhausted: 1 });
    expect(clusterLimit()).toBe(2);
    db.query.mockResolvedValueOnce(links(2)).mockResolvedValueOnce({ rows: [{ walled: true }], rowCount: 1 });
    expect(await evaluateUser("u1")).toEqual({ walled: true, linked: 2, exhausted: 2 });
    const upsert = String(db.query.mock.calls[3][0]);
    expect(upsert).toMatch(/\(NOT abuse_flags\.allowed\) AND/);                             // an administrator's allow always wins
    env.FREE_CLUSTER_LIMIT = "3";
    expect(clusterLimit()).toBe(3);
  });

  it("exports a CSV that neutralises spreadsheet formulas and omits raw network details", () => {
    const csv = flaggedCsv([{
      userId: "u1", email: "=cmd|' /C calc'!A0@example.com", name: 'Ada, "the" admin', walled: true, allowed: false, note: null, linked: 1, exhaustedLinked: 1,
      evaluatedAt: "2026-11-07T00:00:00.000Z", links: [{ email: "b@example.com", reasons: ["device cookie"], exhausted: true }],
    }]);
    const [head, row] = csv.split("\n");
    expect(head).toBe("name,email,status,linked_accounts,linked_that_used_free_allowance,linked_emails,last_evaluated,note");
    expect(row).toContain('"Ada, ""the"" admin"');
    expect(row).toContain("'=cmd");                       // prefixed so Excel/Sheets treat it as text
    expect(row).toContain("upgrade wall");
    expect(csv).not.toMatch(/fingerprint|ip_address|cookie_id/i);
  });

  it("only changes an override for an account that exists", async () => {
    db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect(await setAllowed("nobody", true, null)).toBe(false);
    expect(db.query).toHaveBeenCalledTimes(1);                                              // nothing was written
  });

  it("fails open: a missing signals table never walls anyone", async () => {
    db.query.mockRejectedValueOnce(new Error("relation does not exist"));
    expect(await isWalled("u1")).toBe(false);
  });

  it("tells users yes or no and a count, never who is linked", async () => {
    db.query.mockResolvedValueOnce({ rows: [{ walled: true, linked_accounts: 3 }], rowCount: 1 });
    const status = await statusFor("u1");
    expect(status).toEqual({ walled: true, linkedAccounts: 3 });
    expect(JSON.stringify(status)).not.toMatch(/@|user_id|email/);
  });

  it("records quota exhaustion once a day and re-evaluates the accounts linked to it", async () => {
    const sqls: string[] = [];
    db.query.mockImplementation(async (sql: unknown) => {
      const text = String(sql); sqls.push(text);
      if (text.includes("FROM free_quota_events WHERE user_id")) return { rows: [], rowCount: 0 };
      if (text.includes("WITH me AS")) return { rows: [{ user_id: "u2", by_cookie: true, by_fingerprint: false, exhausted: false }], rowCount: 1 };
      if (text.includes("INSERT INTO abuse_flags")) return { rows: [{ walled: false }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    await markQuotaExhausted("u1", "messages");
    expect(sqls.some(s => s.startsWith("INSERT INTO free_quota_events"))).toBe(true);
    expect(sqls.filter(s => s.includes("INSERT INTO abuse_flags"))).toHaveLength(1);
  });
});
