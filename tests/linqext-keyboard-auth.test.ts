import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

type Link = { id: string; user_id: string; parent: string; device: string | null; refresh: string; prev: string | null; rotated_at: Date | null; access: string | null; access_exp: Date | null; expires: Date; revoked: Date | null };
const state = vi.hoisted(() => ({ links: [] as any[], parentLive: true, verified: true }));
const sha = (v: string) => createHash("sha256").update(v).digest("hex");

const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/admin/db", () => ({ pool: db, transaction: async (run: (c: typeof db) => unknown) => run(db) }));
vi.mock("@/lib/users/auth", async () => ({
  allow: async () => true,
  isMobileClient: (r: Request) => r.headers.get("x-az-client") === "mobile",
  requireUser: async (r: Request) => { if (!r.headers.get("authorization")?.match(/^Bearer [a-f0-9]{64}$/)) throw Object.assign(new Error("SIGN_IN_REQUIRED"), { status: 401, code: "SIGN_IN_REQUIRED" }); return { id: "u1", name: "Ada", email: "a@b.c", verified: true }; },
  strictOrigin: (r: Request) => { if (r.headers.get("x-az-client") !== "mobile") throw Object.assign(new Error("INVALID_ORIGIN"), { status: 403 }); },
  tokenFrom: (r: Request) => r.headers.get("authorization")?.match(/^Bearer ([a-f0-9]{64})$/)?.[1] ?? null,
}));
vi.mock("@/lib/users/types", () => ({ UserError: class extends Error { constructor(public status: number, public code: string) { super(code); } } }));

import { createLink, keyboardUser, linqextUser, refreshLink, unlink } from "@/lib/linqext/keyboard-auth";

const SESSION = "a".repeat(64);
const app = (path: string, extra: Record<string, string> = {}) => new Request(`http://localhost${path}`, { method: "POST", headers: { "x-az-client": "mobile", "x-az-device": "d".repeat(32), authorization: `Bearer ${SESSION}`, ...extra } });
const kb = (token: string, extra: Record<string, string> = {}) => new Request("http://localhost/api/linqext/replies", { method: "POST", headers: { "x-az-client": "mobile", authorization: `Bearer ${token}`, ...extra } });

/** A tiny in-memory stand-in for the three SQL statements the module runs. */
function fakeDb() {
  db.query.mockImplementation(async (sql: unknown, v: any[] = []) => {
    const t = String(sql).replace(/\s+/g, " ");
    const rows = state.links as Link[];
    if (t.startsWith("DELETE FROM linqext_keyboard_links")) return { rows: [], rowCount: 0 };
    if (t.includes("SET revoked_at = now() WHERE user_id = $1 AND device_id = $2")) { rows.filter(l => l.user_id === v[0] && l.device === v[1] && !l.revoked).forEach(l => (l.revoked = new Date())); return { rows: [], rowCount: 1 }; }
    if (t.includes("OFFSET $2")) { rows.filter(l => l.user_id === v[0] && !l.revoked).sort((a, b) => +b.expires - +a.expires).slice(v[1]).forEach(l => (l.revoked = new Date())); return { rows: [], rowCount: 0 }; }
    if (t.startsWith("INSERT INTO linqext_keyboard_links")) {
      rows.push({ id: v[0], user_id: v[1], parent: v[2], device: v[3], refresh: v[4], prev: null, rotated_at: null, access: v[5], access_exp: new Date(Date.now() + v[6] * 1000), expires: new Date(Date.now() + v[7] * 86400e3), revoked: null });
      return { rows: [{ expires_at: rows.at(-1)!.expires }], rowCount: 1 };
    }
    if (t.includes("WHERE l.refresh_hash = $1 OR l.prev_refresh_hash = $1")) {
      const l = rows.find(x => x.refresh === v[0] || x.prev === v[0]);
      return l ? { rows: [{ id: l.id, user_id: l.user_id, refresh_hash: l.refresh, prev_refresh_hash: l.prev, rotated_at: l.rotated_at, revoked_at: l.revoked, expires_at: l.expires, parent_live: state.parentLive, verified: state.verified }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (t.startsWith("UPDATE linqext_keyboard_links SET revoked_at = now() WHERE id = $1")) { const l = rows.find(x => x.id === v[0] && !x.revoked); if (l) l.revoked = new Date(); return { rows: [], rowCount: l ? 1 : 0 }; }
    if (t.startsWith("UPDATE linqext_keyboard_links SET prev_refresh_hash")) { const l = rows.find(x => x.id === v[0])!; l.prev = v[1]; l.refresh = v[2]; l.rotated_at = new Date(); l.access = v[3]; l.access_exp = new Date(Date.now() + v[4] * 1000); return { rows: [], rowCount: 1 }; }
    if (t.startsWith("UPDATE linqext_keyboard_links l SET last_used_at")) {
      const l = rows.find(x => x.access === v[0] && x.access_exp! > new Date() && !x.revoked && x.expires > new Date());
      return l && state.parentLive && state.verified ? { rows: [{ link_id: l.id, id: l.user_id, name: "Ada", email: "a@b.c" }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (t.startsWith("UPDATE linqext_keyboard_links SET revoked_at = now() WHERE user_id = $1 AND parent_session_hash = $2")) { rows.filter(l => l.user_id === v[0] && l.parent === v[1]).forEach(l => (l.revoked = new Date())); return { rows: [], rowCount: 1 }; }
    throw new Error("unexpected SQL: " + t.slice(0, 90));
  });
}

describe("keyboard credentials", () => {
  beforeEach(() => { state.links = []; state.parentLive = true; state.verified = true; process.env.DATABASE_URL = "postgres://test"; db.query.mockReset(); fakeDb(); });

  it("mints a link only for a signed-in app session, stores hashes only, and ties it to that session", async () => {
    await expect(createLink(new Request("http://localhost/x", { method: "POST", headers: { "x-az-client": "mobile" } }))).rejects.toMatchObject({ status: 401 });
    const t = await createLink(app("/api/linqext/keyboard/link"));
    expect(t.accessToken).toMatch(/^azk_[a-f0-9]{64}$/);
    expect(t.refreshToken).toMatch(/^azr_[a-f0-9]{64}$/);
    expect(t.accessExpiresInSeconds).toBe(900);
    const row = state.links[0] as Link;
    expect(row.parent).toBe(sha(SESSION));                                    // bound to the app session
    expect(JSON.stringify(row)).not.toContain(t.accessToken);                 // never stored in clear
    expect(JSON.stringify(row)).not.toContain(t.refreshToken);
    expect(row.access).toBe(sha(t.accessToken));
  });

  it("authorises only with a live link, a live parent session and a verified account", async () => {
    const t = await createLink(app("/x"));
    expect(await keyboardUser(kb(t.accessToken))).toMatchObject({ id: "u1" });
    expect(await keyboardUser(kb("azk_" + "0".repeat(64)))).toBeNull();
    expect(await keyboardUser(kb(SESSION))).toBeNull();                       // an app session is not a keyboard token
    state.parentLive = false;                                                  // app signed out / session revoked / expired / password changed elsewhere
    expect(await keyboardUser(kb(t.accessToken))).toBeNull();
    state.parentLive = true; state.verified = false;
    expect(await keyboardUser(kb(t.accessToken))).toBeNull();
  });

  it("expires access tokens after 15 minutes", async () => {
    const t = await createLink(app("/x"));
    (state.links[0] as Link).access_exp = new Date(Date.now() - 1000);
    expect(await keyboardUser(kb(t.accessToken))).toBeNull();
  });

  it("is scoped: a keyboard token is refused by app-session routes and needs the mobile header to write", async () => {
    const t = await createLink(app("/x"));
    await expect(linqextUser(kb(t.accessToken, { "x-az-client": "web" }), true)).rejects.toMatchObject({ status: 403 });
    expect(await linqextUser(kb(t.accessToken), true)).toMatchObject({ id: "u1" });
    await expect(linqextUser(kb("azk_" + "1".repeat(64)), false)).rejects.toMatchObject({ status: 401 });   // bad keyboard token never falls through to anything else
  });

  it("rotates the refresh token and invalidates the old access token", async () => {
    const t = await createLink(app("/x"));
    const next = await refreshLink(app("/api/linqext/keyboard/refresh"), { refreshToken: t.refreshToken });
    expect(next.refreshToken).not.toBe(t.refreshToken);
    expect(next.accessToken).not.toBe(t.accessToken);
    expect(await keyboardUser(kb(t.accessToken))).toBeNull();
    expect(await keyboardUser(kb(next.accessToken))).toMatchObject({ id: "u1" });
  });

  it("tolerates a retry of the previous refresh token right after rotation (lost response), then treats a later replay as theft and revokes the link", async () => {
    const t = await createLink(app("/x"));
    const a = await refreshLink(app("/r"), { refreshToken: t.refreshToken });
    const retry = await refreshLink(app("/r"), { refreshToken: t.refreshToken });         // within the grace window
    expect(retry.refreshToken).toBeTruthy();
    (state.links[0] as Link).rotated_at = new Date(Date.now() - 120_000);
    (state.links[0] as Link).prev = t.refreshToken ? sha(t.refreshToken) : null;           // an old token, long after rotation
    await expect(refreshLink(app("/r"), { refreshToken: t.refreshToken })).rejects.toMatchObject({ status: 401 });
    expect((state.links[0] as Link).revoked).not.toBeNull();                              // the whole link is dead
    expect(await keyboardUser(kb(a.accessToken))).toBeNull();
  });

  it("cannot refresh once the app session is gone, the link expired, or the token is malformed", async () => {
    const t = await createLink(app("/x"));
    await expect(refreshLink(app("/r"), { refreshToken: "nope" })).rejects.toMatchObject({ status: 401 });
    await expect(refreshLink(app("/r"), { refreshToken: "azr_" + "9".repeat(64) })).rejects.toMatchObject({ status: 401 });
    await expect(refreshLink(app("/r"), null)).rejects.toMatchObject({ status: 401 });
    state.parentLive = false;
    await expect(refreshLink(app("/r"), { refreshToken: t.refreshToken })).rejects.toMatchObject({ status: 401 });
    state.parentLive = true; (state.links[0] as Link).expires = new Date(Date.now() - 1000);
    await expect(refreshLink(app("/r"), { refreshToken: t.refreshToken })).rejects.toMatchObject({ status: 401 });
  });

  it("keeps one live link per device and revokes the app session's links on unlink", async () => {
    const first = await createLink(app("/x"));
    const second = await createLink(app("/x"));
    expect((state.links as Link[]).filter(l => !l.revoked)).toHaveLength(1);
    expect(await keyboardUser(kb(first.accessToken))).toBeNull();
    await unlink(app("/api/linqext/keyboard/unlink"));
    expect(await keyboardUser(kb(second.accessToken))).toBeNull();
  });

  it("lets the keyboard unlink itself with its own token", async () => {
    const t = await createLink(app("/x"));
    await unlink(kb(t.accessToken));
    expect((state.links[0] as Link).revoked).not.toBeNull();
  });
});
