import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { transaction, pool } from "@/lib/admin/db";
import { allow, isMobileClient, requireUser, strictOrigin, tokenFrom } from "@/lib/users/auth";
import { UserError, type SessionUser } from "@/lib/users/types";

// Credentials for the AZLinqext Android keyboard. The keyboard never receives the app's session:
// the signed-in app asks for a "link" (a short-lived access token and a rotating refresh token)
// that only works for /api/linqext/*. See migrations/030_linqext_keyboard.sql.

export const ACCESS_TTL_SECONDS = 15 * 60;
export const LINK_TTL_DAYS = 30;
const MAX_LINKS_PER_USER = 5;
const REFRESH_GRACE_SECONDS = 30; // a retry of the previous refresh token (lost response) is tolerated this long
const ACCESS_RE = /^Bearer (azk_[a-f0-9]{64})$/;
const REFRESH_RE = /^azr_[a-f0-9]{64}$/;

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const newAccess = () => `azk_${randomBytes(32).toString("hex")}`;
const newRefresh = () => `azr_${randomBytes(32).toString("hex")}`;

export type KeyboardTokens = { accessToken: string; accessExpiresInSeconds: number; refreshToken: string; refreshExpiresAt: string };

/** The app (signed in, with its own session) creates a link for this device's keyboard. */
export async function createLink(request: Request): Promise<KeyboardTokens & { userId: string }> {
  const user = await requireUser(request, true);
  const session = tokenFrom(request);
  if (!session) throw new UserError(401, "SIGN_IN_REQUIRED");
  if (!await allow("kbd-link", user.id, 10)) throw new UserError(429, "RATE_LIMITED");
  const device = request.headers.get("x-az-device")?.match(/^[a-f0-9]{32}$/)?.[0] ?? null;
  const access = newAccess(), refresh = newRefresh();
  const refreshExpiresAt = await transaction(async db => {
    await db.query(`DELETE FROM linqext_keyboard_links WHERE expires_at < now() - interval '7 days' OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '7 days')`);
    // One live link per device, and a cap per account (oldest are revoked first).
    if (device) await db.query(`UPDATE linqext_keyboard_links SET revoked_at = now() WHERE user_id = $1 AND device_id = $2 AND revoked_at IS NULL`, [user.id, device]);
    await db.query(
      `UPDATE linqext_keyboard_links SET revoked_at = now() WHERE id IN (
         SELECT id FROM linqext_keyboard_links WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC OFFSET $2)`, [user.id, MAX_LINKS_PER_USER - 1]);
    const row = await db.query(
      `INSERT INTO linqext_keyboard_links (id, user_id, parent_session_hash, device_id, refresh_hash, access_hash, access_expires_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(secs => $7), now() + make_interval(days => $8)) RETURNING expires_at`,
      [randomUUID(), user.id, sha(session), device, sha(refresh), sha(access), ACCESS_TTL_SECONDS, LINK_TTL_DAYS]);
    return new Date(row.rows[0].expires_at).toISOString();
  });
  return { userId: user.id, accessToken: access, accessExpiresInSeconds: ACCESS_TTL_SECONDS, refreshToken: refresh, refreshExpiresAt };
}

/**
 * Rotates a refresh token. Presenting a refresh token that was already replaced (outside the short
 * grace for a lost response) is treated as theft and revokes the whole link.
 */
export async function refreshLink(request: Request, raw: unknown): Promise<KeyboardTokens> {
  strictOrigin(request);
  const token = (raw as { refreshToken?: unknown } | null)?.refreshToken;
  if (typeof token !== "string" || !REFRESH_RE.test(token)) throw new UserError(401, "INVALID_REFRESH");
  const hash = sha(token);
  const access = newAccess(), refresh = newRefresh();
  const result = await transaction(async db => {
    const row = (await db.query(
      `SELECT l.id, l.user_id, l.refresh_hash, l.prev_refresh_hash, l.rotated_at, l.revoked_at, l.expires_at,
              (s.token_hash IS NOT NULL) AS parent_live, (u.email_verified_at IS NOT NULL) AS verified
       FROM linqext_keyboard_links l
       JOIN users u ON u.id = l.user_id
       LEFT JOIN user_sessions s ON s.token_hash = l.parent_session_hash AND s.revoked_at IS NULL AND s.expires_at > now()
       WHERE l.refresh_hash = $1 OR l.prev_refresh_hash = $1 FOR UPDATE OF l`, [hash])).rows[0];
    if (!row || row.revoked_at || new Date(row.expires_at) <= new Date() || !row.parent_live || !row.verified) return null;
    if (row.refresh_hash !== hash) {
      const recent = row.rotated_at && Date.now() - new Date(row.rotated_at).getTime() <= REFRESH_GRACE_SECONDS * 1000;
      if (!recent) { await db.query(`UPDATE linqext_keyboard_links SET revoked_at = now() WHERE id = $1`, [row.id]); return null; } // replay: revoke the family
    }
    await db.query(
      `UPDATE linqext_keyboard_links SET prev_refresh_hash = $2, refresh_hash = $3, rotated_at = now(), access_hash = $4,
         access_expires_at = now() + make_interval(secs => $5), last_used_at = now() WHERE id = $1`,
      [row.id, row.refresh_hash, sha(refresh), sha(access), ACCESS_TTL_SECONDS]);
    return { expiresAt: new Date(row.expires_at).toISOString() };
  });
  if (!result) throw new UserError(401, "INVALID_REFRESH");
  return { accessToken: access, accessExpiresInSeconds: ACCESS_TTL_SECONDS, refreshToken: refresh, refreshExpiresAt: result.expiresAt };
}

/** Revokes this device's link: from the keyboard (its own access token) or from the app (its session). */
export async function unlink(request: Request): Promise<void> {
  strictOrigin(request);
  const keyboard = await keyboardUser(request);
  if (keyboard) { await pool.query(`UPDATE linqext_keyboard_links SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, [keyboard.linkId]); return; }
  const session = tokenFrom(request);
  const user = await requireUser(request, true);
  await pool.query(`UPDATE linqext_keyboard_links SET revoked_at = now() WHERE user_id = $1 AND parent_session_hash = $2 AND revoked_at IS NULL`, [user.id, sha(session!)]);
}

/** The user behind a keyboard access token, or null. Needs a live link, a live parent session and a verified account. */
export async function keyboardUser(request: Request): Promise<(SessionUser & { linkId: string }) | null> {
  const token = request.headers.get("authorization")?.match(ACCESS_RE)?.[1];
  if (!token || !process.env.DATABASE_URL) return null;
  try {
    const r = (await pool.query(
      `UPDATE linqext_keyboard_links l SET last_used_at = now()
       FROM users u, user_sessions s
       WHERE l.access_hash = $1 AND l.access_expires_at > now() AND l.revoked_at IS NULL AND l.expires_at > now()
         AND u.id = l.user_id AND u.email_verified_at IS NOT NULL
         AND s.token_hash = l.parent_session_hash AND s.revoked_at IS NULL AND s.expires_at > now()
       RETURNING l.id AS link_id, u.id, u.name, u.email`, [sha(token)])).rows[0];
    return r ? { id: r.id, name: r.name, email: r.email, verified: true, linkId: r.link_id } : null;
  } catch { return null; }
}

/** Who is calling a /api/linqext route: the keyboard (scoped token) or the app (its session). */
export async function linqextUser(request: Request, write: boolean): Promise<SessionUser> {
  const keyboard = request.headers.get("authorization")?.startsWith("Bearer azk_") ? await keyboardUser(request) : null;
  if (!keyboard) {
    if (request.headers.get("authorization")?.startsWith("Bearer azk_")) throw new UserError(401, "SIGN_IN_REQUIRED");
    return requireUser(request, write);
  }
  if (write) {
    if (!isMobileClient(request)) throw new UserError(403, "INVALID_ORIGIN");
    if (!await allow("user-write", keyboard.id, 60)) throw new UserError(429, "RATE_LIMITED");
  }
  return keyboard;
}
