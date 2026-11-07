import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { pool, transaction } from "@/lib/admin/db";
import { isLocalRequest, webActor, type RequestActor } from "@/lib/pipeline/actor";
import { dummyHash, hashPassword, passwordProblem, verifyPassword } from "@/lib/staff/password";
import { assertMailReady, sendVerificationEmail } from "./mail";
import { createToken } from "./tokens";
import { UserError, type SessionUser } from "./types";

// End-user accounts: email + password (scrypt), an opaque session cookie whose hash is the only
// thing stored, per-IP and per-email rate limits, account lockout, strict same-origin checks on
// every write, and responses that don't reveal whether an email has an account.

export const USER_COOKIE = "az_user";
export const SESSION_DAYS = 14;
const MAX_SESSIONS = 10;
const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;
export const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => [...w][0]).join("").toUpperCase() || "?";

export const registerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().max(200),
  fingerprint: z.string().max(64).optional(), // a browser hash; used only for abuse prevention (lib/abuse)
}).strict();
export const signInSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
  fingerprint: z.string().max(64).optional(),
}).strict();

// ---- request hygiene ----

const appOrigin = () => process.env.APP_ORIGIN || "http://localhost:3000";
const secure = () => appOrigin().startsWith("https://");

/**
 * The A-Zee mobile app sends `X-AZ-Client: mobile`. A native app has no Origin header, and a web
 * page can't add that custom header to a cross-site request (the browser would need a CORS
 * preflight, and this API never allows one), so it works as the app's proof of origin. Sessions
 * for the app travel as `Authorization: Bearer <token>`, not cookies, so there is nothing for a
 * cross-site request to ride on either.
 */
export const isMobileClient = (request: Request) => request.headers.get("x-az-client") === "mobile";
export const MOBILE_SESSION_DAYS = 60;
const sessionDaysFor = (request: Request) => (isMobileClient(request) ? MOBILE_SESSION_DAYS : SESSION_DAYS);

/** Writes must come from this app's own pages (or the mobile app). A missing Origin is accepted only for same-origin fetches. */
export function strictOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin) { if (origin !== appOrigin()) throw new UserError(403, "INVALID_ORIGIN"); return; }
  if (isMobileClient(request)) return;
  const site = request.headers.get("sec-fetch-site");
  if (site !== "same-origin" && site !== "none") throw new UserError(403, "INVALID_ORIGIN");
}

export const clientKey = (request: Request) =>
  process.env.TRUST_PROXY === "true" ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown" : "shared";

/** Fixed one-minute window on the shared rate-limit table. Fails closed when the database is down. */
export async function allow(scope: string, id: string, perMinute: number): Promise<boolean> {
  const key = sha(`${scope}:${id}`);
  const result = await pool.query(
    `INSERT INTO admin_rate_limits (key, bucket, hits) VALUES ($1, $2, 1)
     ON CONFLICT (key, bucket) DO UPDATE SET hits = admin_rate_limits.hits + 1 RETURNING hits`,
    [key, Math.floor(Date.now() / 60000)],
  );
  return result.rows[0].hits <= perMinute;
}

// ---- cookies and sessions ----

export function sessionCookie(token: string) {
  return `${USER_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure() ? "; Secure" : ""}`;
}
export const clearedCookie = () => `${USER_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure() ? "; Secure" : ""}`;

/** The session token this request carries: a Bearer token (the mobile app) or the session cookie (browsers). */
export function tokenFrom(request: Request): string | null {
  const bearer = request.headers.get("authorization")?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (bearer) return bearer;
  const match = request.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${USER_COOKIE}=([a-f0-9]{64})(?:;|$)`));
  return match ? match[1] : null;
}

export async function createSession(userId: string, db: { query: (text: string, values?: unknown[]) => Promise<unknown> } = pool, days = SESSION_DAYS): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await db.query(`INSERT INTO user_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))`, [sha(token), userId, days]);
  // Keep only the newest sessions per user, so a leaked-and-forgotten login can't pile up.
  await db.query(
    `DELETE FROM user_sessions WHERE user_id = $1 AND token_hash NOT IN
       (SELECT token_hash FROM user_sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT ${MAX_SESSIONS})`, [userId]);
  return token;
}

/**
 * The signed-in user for this request, or null (also null when there is no database). Accounts
 * whose email isn't verified yet count as signed out everywhere except the few routes that let
 * them finish verifying (`allowUnverified`).
 */
export async function sessionUser(request: Request, options: { allowUnverified?: boolean } = {}): Promise<SessionUser | null> {
  if (!process.env.DATABASE_URL) return null;
  const token = tokenFrom(request);
  if (!token) return null;
  try {
    const r = await pool.query(
      `SELECT u.id, u.name, u.email, u.email_verified_at IS NOT NULL AS verified FROM user_sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`, [sha(token)]);
    const row = r.rows[0];
    if (!row || (!row.verified && !options.allowUnverified)) return null;
    return { id: row.id, name: row.name, email: row.email, verified: Boolean(row.verified) };
  } catch { return null; }
}

/** Throws 401 unless signed in; for writes it also enforces the same-origin rule. */
export async function requireUser(request: Request, write = false): Promise<SessionUser> {
  if (write) strictOrigin(request);
  const user = await sessionUser(request);
  if (!user) throw new UserError(401, "SIGN_IN_REQUIRED");
  if (write && !await allow("user-write", user.id, 60)) throw new UserError(429, "RATE_LIMITED");
  return user;
}

/** The pipeline actor for this request: signed in with a session, otherwise a limited guest. */
export async function actorFor(request: Request): Promise<{ actor: RequestActor; newAnonId: string | null }> {
  return webActor(request, await sessionUser(request));
}

// ---- register / sign in / sign out ----

export async function register(request: Request, raw: unknown): Promise<{ token: string; user: SessionUser; verifyToken: string | null }> {
  strictOrigin(request);
  assertMailReady(); // never create an account nobody can verify
  if (!await allow("register", clientKey(request), 5)) throw new UserError(429, "RATE_LIMITED");
  const input = registerSchema.parse(raw);
  const problem = passwordProblem(input.password);
  if (problem) throw new UserError(422, "WEAK_PASSWORD");
  const hash = await hashPassword(input.password);

  const created = await transaction(async db => {
    const existing = (await db.query(
      `SELECT u.id, u.name, u.email, u.is_local, c.user_id AS has_credentials FROM users u
       LEFT JOIN user_credentials c ON c.user_id = u.id WHERE lower(u.email) = $1 FOR UPDATE OF u`, [input.email])).rows[0];
    let id: string;
    if (existing) {
      // The machine's pre-existing local account (it has no password yet) can be claimed, but only
      // from this machine. Anywhere else an existing email is simply unavailable.
      if (existing.has_credentials || !existing.is_local || !isLocalRequest(request)) throw new UserError(409, "REGISTRATION_FAILED");
      id = existing.id;
      await db.query(`UPDATE users SET name = $2, is_local = false, email_verified_at = coalesce(email_verified_at, now()), updated_at = now() WHERE id = $1`, [id, input.name]);
    } else {
      id = randomUUID();
      await db.query(`INSERT INTO users (id, email, name, avatar_initials) VALUES ($1, $2, $3, $4)`, [id, input.email, input.name, initialsOf(input.name)]);
      const workspace = randomUUID();
      await db.query(`INSERT INTO workspaces (id, name, owner_id, is_personal, status) VALUES ($1, 'Personal account', $2, true, 'active')`, [workspace, id]);
      await db.query(`INSERT INTO user_workspaces (user_id, workspace_id, role) VALUES ($1, $2, 'owner')`, [id, workspace]);
    }
    await db.query(`INSERT INTO user_credentials (user_id, password_hash) VALUES ($1, $2)`, [id, hash]);
    await db.query(`INSERT INTO notifications (user_id, title, body) VALUES ($1, 'Welcome to AZ_AI', 'Your account is ready. Chats, favorites, projects and your prompt library are saved to it.')`, [id]);
    const token = await createSession(id, db, sessionDaysFor(request));
    const claimed = Boolean(existing);
    const verifyToken = claimed ? null : await createToken(db, id, "verify");
    return { token, user: { id, name: input.name, email: input.email, verified: claimed }, verifyToken };
  });
  // The email goes out after the account exists; if it fails the user can ask for another.
  if (created.verifyToken) await sendVerificationEmail(created.user.email, created.user.name, created.verifyToken).catch(error => console.warn("verification email failed:", (error as Error)?.message?.slice(0, 200)));
  return created;
}

export async function signIn(request: Request, raw: unknown): Promise<{ token: string; user: SessionUser }> {
  strictOrigin(request);
  const input = signInSchema.parse(raw);
  if (!await allow("signin-ip", clientKey(request), 20) || !await allow("signin-email", input.email, 10)) throw new UserError(429, "RATE_LIMITED");
  const row = (await pool.query(
    `SELECT u.id, u.name, u.email, u.email_verified_at IS NOT NULL AS verified, c.password_hash, c.failed_attempts, c.locked_until > now() AS locked
     FROM users u JOIN user_credentials c ON c.user_id = u.id WHERE lower(u.email) = $1`, [input.email])).rows[0];
  if (!row) { await verifyPassword(input.password, await dummyHash()); throw new UserError(401, "INVALID_CREDENTIALS"); }
  if (row.locked) { await verifyPassword(input.password, await dummyHash()); throw new UserError(401, "INVALID_CREDENTIALS"); }
  if (!await verifyPassword(input.password, row.password_hash)) {
    await pool.query(
      `UPDATE user_credentials SET failed_attempts = failed_attempts + 1,
         locked_until = CASE WHEN failed_attempts + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END
       WHERE user_id = $1`, [row.id, MAX_FAILURES, LOCK_MINUTES]);
    throw new UserError(401, "INVALID_CREDENTIALS");
  }
  await pool.query(`UPDATE user_credentials SET failed_attempts = 0, locked_until = NULL WHERE user_id = $1`, [row.id]);
  return { token: await createSession(row.id, pool, sessionDaysFor(request)), user: { id: row.id, name: row.name, email: row.email, verified: Boolean(row.verified) } };
}

export async function signOut(request: Request) {
  strictOrigin(request);
  const token = tokenFrom(request);
  if (token) await pool.query(`UPDATE user_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`, [sha(token)]);
}

/** Uniform JSON for every user-facing route. Internal errors never leak details. */
export function userFailure(error: unknown): Response {
  const headers = { "Cache-Control": "no-store" };
  if (error instanceof Response) return error;
  if (error instanceof UserError) return Response.json({ error: error.code }, { status: error.status, headers });
  if (error instanceof z.ZodError) return Response.json({ error: "INVALID_INPUT", issues: error.issues.slice(0, 5).map(i => `${i.path.join(".") || "body"}: ${i.message}`) }, { status: 422, headers });
  if (error instanceof SyntaxError) return Response.json({ error: "INVALID_JSON" }, { status: 422, headers });
  console.warn("user API failed:", (error as Error)?.message?.slice(0, 200));
  return Response.json({ error: "SERVICE_UNAVAILABLE" }, { status: 503, headers });
}
