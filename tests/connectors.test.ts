import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decrypt, encrypt, pkceChallenge, tokenKeyConfigured } from "@/lib/connectors/crypto";
import { githubProvider } from "@/lib/connectors/github";
import { gmailProvider } from "@/lib/connectors/gmail";
import { googleDriveProvider } from "@/lib/connectors/google-drive";
import { CATALOG } from "@/lib/connectors/catalog";
import { ConnectorError, readOnly } from "@/lib/connectors/types";
import { featureEnabled, FEATURES } from "@/lib/features";

const KEY = Buffer.alloc(32, 7).toString("base64");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("token encryption", () => {
  afterEach(() => { delete process.env.CONNECTOR_TOKEN_KEY; });

  it("round-trips, uses a fresh IV each time, and detects tampering", () => {
    process.env.CONNECTOR_TOKEN_KEY = KEY;
    const a = encrypt("gho_secret"), b = encrypt("gho_secret");
    expect(a).not.toBe(b);
    expect(a).not.toContain("gho_secret");
    expect(decrypt(a)).toBe("gho_secret");
    const [v, iv, tag, body] = a.split(".");
    const flipped = body.slice(0, -2) + (body.endsWith("A") ? "B" : "A") + body.slice(-1);
    expect(() => decrypt([v, iv, tag, flipped].join("."))).toThrow();
    process.env.CONNECTOR_TOKEN_KEY = Buffer.alloc(32, 9).toString("base64");
    expect(() => decrypt(a)).toThrow();   // wrong key
  });

  it("refuses to work without a valid 32-byte key", () => {
    expect(tokenKeyConfigured()).toBe(false);
    expect(() => encrypt("x")).toThrow("CONNECTOR_KEY_MISSING");
    process.env.CONNECTOR_TOKEN_KEY = Buffer.alloc(16).toString("base64");
    expect(tokenKeyConfigured()).toBe(false);
  });
});

describe("OAuth consent URLs", () => {
  beforeEach(() => {
    Object.assign(process.env, { GITHUB_CLIENT_ID: "gh-id", GITHUB_CLIENT_SECRET: "gh-secret", GOOGLE_CLIENT_ID: "g-id", GOOGLE_CLIENT_SECRET: "g-secret" });
  });
  afterEach(() => { for (const k of ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GITHUB_SCOPES"]) delete process.env[k]; });

  it("GitHub: client id, callback, scopes and state; secret never in the URL", () => {
    const url = new URL(githubProvider().authorizeUrl({ state: "s1", codeChallenge: "c", redirectUri: "http://localhost:3000/api/connectors/github/callback" }));
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ client_id: "gh-id", state: "s1", scope: "read:user repo", redirect_uri: "http://localhost:3000/api/connectors/github/callback" });
    expect(url.toString()).not.toContain("gh-secret");
    process.env.GITHUB_SCOPES = "read:user public_repo";
    expect(new URL(githubProvider().authorizeUrl({ state: "s", codeChallenge: "c", redirectUri: "r" })).searchParams.get("scope")).toBe("read:user public_repo");
  });

  it("Google: read-only Drive scope, offline access, PKCE S256", () => {
    const verifier = "v".repeat(64);
    const url = new URL(googleDriveProvider().authorizeUrl({ state: "s2", codeChallenge: pkceChallenge(verifier), redirectUri: "r" }));
    const p = Object.fromEntries(url.searchParams);
    expect(p.scope.split(" ")).toContain("https://www.googleapis.com/auth/drive.readonly");
    expect(p.scope).not.toMatch(/auth\/drive( |$)/);   // never full Drive access
    expect(p).toMatchObject({ response_type: "code", access_type: "offline", code_challenge_method: "S256", state: "s2" });
    expect(p.code_challenge).toBe(pkceChallenge(verifier));
    expect(p.code_challenge).toMatch(/^[\w-]{43}$/);
  });
});

describe("read-only provider access", () => {
  it("only issues GET requests and maps provider errors", async () => {
    const fetchImpl = vi.fn(async () => json({ ok: true }));
    await readOnly(fetchImpl, "https://api.example/x", "tok");
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    await expect(readOnly(vi.fn(async () => json({}, 401)), "u", "t")).rejects.toMatchObject({ code: "CONNECTOR_UNAUTHORIZED" });
    await expect(readOnly(vi.fn(async () => json({}, 404)), "u", "t")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(readOnly(vi.fn(async () => new Response("x".repeat(50), { headers: { "content-length": "50" } })), "u", "t", "*/*", 10)).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
  });

  it("GitHub file reads decode text and refuse binary files", async () => {
    const gh = githubProvider(vi.fn(async (url: unknown) => String(url).includes("bin.png")
      ? json({ type: "file", path: "bin.png", size: 4, sha: "s", encoding: "base64", content: Buffer.from([0x89, 0, 1, 2]).toString("base64") })
      : json({ type: "file", path: "README.md", size: 5, sha: "s", encoding: "base64", content: Buffer.from("Hello").toString("base64") })));
    expect((await gh.file("t", "o", "r", "README.md")).content).toBe("Hello");
    await expect(gh.file("t", "o", "r", "bin.png")).rejects.toMatchObject({ code: "BINARY_FILE" });
  });

  it("Drive: escapes the search query, exports Google Docs as text, refuses other binaries", async () => {
    const urls: string[] = [];
    const drive = googleDriveProvider(vi.fn(async (url: unknown) => {
      const u = String(url); urls.push(u);
      if (u.includes("/files?")) return json({ files: [{ id: "doc12345", name: "Plan", mimeType: "application/vnd.google-apps.document" }, { id: "img12345", name: "Pic", mimeType: "image/png" }] });
      if (u.includes("doc12345?fields")) return json({ id: "doc12345", name: "Plan", mimeType: "application/vnd.google-apps.document" });
      if (u.includes("img12345?fields")) return json({ id: "img12345", name: "Pic", mimeType: "image/png" });
      if (u.includes("/export")) return new Response("Plan text");
      return json({}, 404);
    }));
    const list = await drive.listFiles("t", "it's a \\ test");
    expect(decodeURIComponent(new URL(urls[0]).searchParams.get("q")!)).toBe("trashed = false and name contains 'it\\'s a \\\\ test'");
    expect(list.files.map(f => [f.name, f.readable])).toEqual([["Plan", true], ["Pic", false]]);
    expect(await drive.fileText("t", "doc12345")).toMatchObject({ content: "Plan text" });
    expect(urls.at(-1)).toContain("/export?mimeType=text%2Fplain");
    await expect(drive.fileText("t", "img12345")).rejects.toBeInstanceOf(ConnectorError);
    await expect(drive.fileText("t", "../etc")).rejects.toMatchObject({ code: "INVALID_FILE_ID" });
  });

  it("Gmail: asks only for gmail.readonly, lists message headers, and never sends a non-GET", async () => {
    Object.assign(process.env, { GOOGLE_CLIENT_ID: "g-id", GOOGLE_CLIENT_SECRET: "g-secret" });
    const url = new URL(gmailProvider().authorizeUrl({ state: "s", codeChallenge: "c", redirectUri: "http://localhost:3000/api/connectors/gmail/callback" }));
    expect(url.searchParams.get("scope")).toBe("openid email https://www.googleapis.com/auth/gmail.readonly");
    delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET;

    const calls: { url: string; method?: string }[] = [];
    const mail = gmailProvider(vi.fn(async (u: unknown, init?: RequestInit) => {
      calls.push({ url: String(u), method: init?.method });
      if (String(u).includes("/messages?")) return json({ messages: [{ id: "msg00001" }, { id: "msg00002" }] });
      const unread = String(u).includes("msg00001");
      return json({ id: unread ? "msg00001" : "msg00002", threadId: "thr00001", snippet: "Hi there", labelIds: unread ? ["INBOX", "UNREAD"] : ["INBOX"],
        payload: { headers: unread ? [{ name: "From", value: "Ana <ana@example.com>" }, { name: "Subject", value: "Lunch?" }, { name: "Date", value: "Mon, 2 Nov 2026 10:00:00 +0000" }] : [] } });
    }));
    const { messages } = await mail.search("tok", "is:unread");
    expect(new URL(calls[0].url).searchParams.get("q")).toBe("is:unread");
    expect(messages).toMatchObject([{ from: "Ana <ana@example.com>", subject: "Lunch?", unread: true }, { from: "Unknown sender", subject: "(no subject)", unread: false }]);
    expect(calls.every(c => c.method === "GET")).toBe(true);
    await expect(gmailProvider(vi.fn(async (u: unknown) => String(u).includes("/messages?") ? json({ messages: [{ id: "../x" }] }) : json({}))).search("tok")).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  });
});

describe("plugins catalog", () => {
  it("only entries backed by a real provider can connect; the rest are coming soon", () => {
    expect(CATALOG.filter(c => c.provider).map(c => c.provider).sort()).toEqual(["github", "gmail", "google_drive"]);
    expect(new Set(CATALOG.map(c => c.id)).size).toBe(CATALOG.length);
    expect(CATALOG.find(c => c.id === "gmail")?.details?.map(d => d.title)).toContain("Search your emails");
  });
});

describe("feature flags", () => {
  it("experimental features can be switched off; blocked ones are never on", () => {
    expect(featureEnabled("connectors", {})).toBe(true);
    expect(featureEnabled("connectors", { AZ_FEATURE_CONNECTORS: "off" })).toBe(false);
    expect(featureEnabled("codeExecution", { AZ_FEATURE_CODE_EXECUTION: "on" })).toBe(false);
    expect(FEATURES.codeExecution.readiness).toBe("infrastructure_blocked");
    expect(Object.values(FEATURES).some(f => f.readiness === "production_ready")).toBe(false);
    expect(featureEnabled("voice", { AZ_FEATURE_VOICE: "on" })).toBe(FEATURES.voice.readiness !== "planned");
  });
});
