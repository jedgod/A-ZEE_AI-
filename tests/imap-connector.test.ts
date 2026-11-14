import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ query: vi.fn(async (..._a: unknown[]) => ({ rows: [] as any[], rowCount: 0 })) }));
vi.mock("@/lib/admin/db", () => ({ pool: db }));
vi.mock("@/lib/connectors/service", () => ({ audit: vi.fn(async () => undefined) }));

import { connectAccount, disconnectAccount, unreadEmails, type ImapClient, type ImapFactory } from "@/lib/connectors/imap";

const env = process.env as Record<string, string | undefined>;
const PASSWORD = "abcdefghijklmnop";

const mail = (subject: string, from = "Pat <pat@example.com>") => Buffer.from(`From: ${from}\r\nSubject: ${subject}\r\nDate: Tue, 10 Nov 2026 10:00:00 +0000\r\n\r\nHello   there,\r\n  this is the body.\r\n`);

function server(options: { failLogin?: "auth" | "net"; messages?: Buffer[] } = {}) {
  const log: string[] = [];
  const factory: ImapFactory = (host, user, pass) => {
    log.push(`${host}|${user}|${pass}`);
    const client: ImapClient = {
      async connect() {
        if (options.failLogin === "auth") throw Object.assign(new Error("Command failed"), { authenticationFailed: true });
        if (options.failLogin === "net") throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
      },
      async logout() { /* closed */ },
      async getMailboxLock() { return { release() { /* released */ } }; },
      async search() { return (options.messages ?? []).map((_, i) => i + 1); },
      async *fetch(range) { for (const uid of range) yield { source: (options.messages ?? [])[uid - 1] }; },
    };
    return client;
  };
  return { factory, log };
}

beforeEach(() => {
  db.query.mockReset(); db.query.mockResolvedValue({ rows: [], rowCount: 0 });
  env.CONNECTOR_TOKEN_KEY = Buffer.alloc(32, 7).toString("base64");
  delete env.AZ_PROVIDER_MODE;
});

describe("connectAccount", () => {
  it("verifies the login against the fixed host, strips spaces from the code, and stores it sealed", async () => {
    const s = server();
    const r = await connectAccount("u1", { provider: "yahoo", email: " Me@Yahoo.com ", appPassword: "abcd efgh ijkl mnop" }, s.factory);
    expect(r).toEqual({ provider: "yahoo", email: "me@yahoo.com" });
    expect(s.log).toEqual([`imap.mail.yahoo.com|me@yahoo.com|${PASSWORD}`]);
    const [sql, params] = db.query.mock.calls[0] as [string, string[]];
    expect(sql).toContain("INSERT INTO imap_accounts");
    expect(params.slice(0, 3)).toEqual(["u1", "yahoo", "me@yahoo.com"]);
    expect(params[3]).toMatch(/^v1\./);
    expect(params[3]).not.toContain(PASSWORD);
    expect(JSON.stringify(params)).not.toContain(PASSWORD);
  });
  it("uses the iCloud host for iCloud", async () => {
    const s = server();
    await connectAccount("u1", { provider: "icloud", email: "me@icloud.com", appPassword: PASSWORD }, s.factory);
    expect(s.log[0]).toMatch(/^imap\.mail\.me\.com\|/);
  });
  it("rejects a wrong password without storing anything", async () => {
    await expect(connectAccount("u1", { provider: "yahoo", email: "me@yahoo.com", appPassword: PASSWORD }, server({ failLogin: "auth" }).factory)).rejects.toMatchObject({ status: 401, code: "IMAP_AUTH_FAILED" });
    expect(db.query.mock.calls.some(c => String(c[0]).includes("INSERT INTO imap_accounts"))).toBe(false);
  });
  it("reports an unreachable server separately", async () => {
    await expect(connectAccount("u1", { provider: "yahoo", email: "me@yahoo.com", appPassword: PASSWORD }, server({ failLogin: "net" }).factory)).rejects.toMatchObject({ status: 502, code: "IMAP_UNREACHABLE" });
  });
  it("is blocked in ollama-only privacy mode, before any connection", async () => {
    env.AZ_PROVIDER_MODE = "ollama-only";
    const s = server();
    await expect(connectAccount("u1", { provider: "yahoo", email: "me@yahoo.com", appPassword: PASSWORD }, s.factory)).rejects.toMatchObject({ status: 403, code: "EXTERNAL_DATA_DISABLED" });
    expect(s.log).toHaveLength(0);
  });
  it("refuses unknown providers, bad emails and short codes", async () => {
    const s = server();
    await expect(connectAccount("u1", { provider: "aol" as never, email: "a@b.co", appPassword: PASSWORD }, s.factory)).rejects.toThrow();
    await expect(connectAccount("u1", { provider: "yahoo", email: "nope", appPassword: PASSWORD }, s.factory)).rejects.toThrow();
    await expect(connectAccount("u1", { provider: "yahoo", email: "a@yahoo.com", appPassword: "short" }, s.factory)).rejects.toThrow();
    expect(s.log).toHaveLength(0);
  });
});

describe("unreadEmails", () => {
  async function sealedFor(provider: "yahoo" | "icloud") {
    await connectAccount("u1", { provider, email: `me@${provider}.com`, appPassword: PASSWORD }, server().factory);
    const params = db.query.mock.calls.find(c => String(c[0]).includes("INSERT INTO imap_accounts"))![1] as string[];
    db.query.mockClear(); db.query.mockResolvedValue({ rows: [], rowCount: 0 });
    return { provider, credentials_enc: params[3] };
  }

  it("decrypts the stored login, reads the newest unread mail, and returns clean snippets newest first", async () => {
    const row = await sealedFor("yahoo");
    db.query.mockResolvedValueOnce({ rows: [row], rowCount: 1 });
    const s = server({ messages: [mail("Older"), mail("Newer")] });
    const r = await unreadEmails("u1", undefined, s.factory);
    expect(s.log[0]).toBe(`imap.mail.yahoo.com|me@yahoo.com|${PASSWORD}`);
    expect(r.errors).toEqual([]);
    expect(r.emails.map(e => e.subject)).toEqual(["Newer", "Older"]);
    expect(r.emails[0]).toMatchObject({ provider: "yahoo", from: expect.stringContaining("pat@example.com"), snippet: "Hello there, this is the body." });
  });
  it("keeps going when one account fails", async () => {
    const yahoo = await sealedFor("yahoo"), icloud = await sealedFor("icloud");
    db.query.mockResolvedValueOnce({ rows: [yahoo, icloud], rowCount: 2 });
    let n = 0;
    const factory: ImapFactory = (host, user, pass) => (n++ === 0 ? server({ failLogin: "net" }) : server({ messages: [mail("Hi")] })).factory(host, user, pass);
    const r = await unreadEmails("u1", undefined, factory);
    expect(r.errors).toEqual([{ provider: "yahoo", error: "READ_FAILED" }]);
    expect(r.emails.map(e => e.provider)).toEqual(["icloud"]);
  });
  it("returns a tampered credential as a failed read instead of using it", async () => {
    const row = await sealedFor("yahoo");
    db.query.mockResolvedValueOnce({ rows: [{ ...row, credentials_enc: row.credentials_enc.slice(0, -4) + "AAAA" }], rowCount: 1 });
    const s = server({ messages: [mail("x")] });
    const r = await unreadEmails("u1", undefined, s.factory);
    expect(r.emails).toEqual([]);
    expect(r.errors).toHaveLength(1);
    expect(s.log).toHaveLength(0);
  });
  it("is blocked in ollama-only mode", async () => {
    env.AZ_PROVIDER_MODE = "ollama-only";
    await expect(unreadEmails("u1")).rejects.toMatchObject({ status: 403 });
  });
});

describe("disconnectAccount", () => {
  it("deletes the row (and so the credentials) for the owner only", async () => {
    db.query.mockResolvedValueOnce({ rows: [{ email: "me@yahoo.com" }], rowCount: 1 });
    expect(await disconnectAccount("u1", "yahoo")).toBe(true);
    const [sql, params] = db.query.mock.calls[0] as [string, string[]];
    expect(sql).toContain("DELETE FROM imap_accounts");
    expect(params).toEqual(["u1", "yahoo"]);
  });
  it("returns false when nothing was connected", async () => {
    expect(await disconnectAccount("u1", "icloud")).toBe(false);
  });
});
