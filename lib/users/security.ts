import "server-only";
import { z } from "zod";
import { pool, transaction } from "@/lib/admin/db";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/staff/password";
import { allow, clientKey, requireUser, sessionUser, sha, strictOrigin, USER_COOKIE } from "./auth";
import { sendResetEmail, sendVerificationEmail } from "./mail";
import { consumeToken, createToken } from "./tokens";
import { UserError } from "./types";

// Email verification, password reset, password change and "sign out everywhere".

const tokenSchema = z.object({ token: z.string().max(100) }).strict();
const emailSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).strict();
const resetSchema = z.object({ token: z.string().max(100), password: z.string().max(200) }).strict();
const changeSchema = z.object({ current: z.string().min(1).max(200), next: z.string().max(200) }).strict();

const revokeAll = (db: { query: typeof pool.query }, userId: string, exceptHash?: string) =>
  db.query(`UPDATE user_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL AND ($2::text IS NULL OR token_hash <> $2)`, [userId, exceptHash ?? null]);

/** Spends an emailed verify token and marks the email verified. */
export async function verifyEmail(request: Request, raw: unknown) {
  strictOrigin(request);
  if (!await allow("verify", clientKey(request), 30)) throw new UserError(429, "RATE_LIMITED");
  const { token } = tokenSchema.parse(raw);
  await transaction(async db => {
    const userId = await consumeToken(db, token, "verify");
    if (!userId) throw new UserError(400, "INVALID_OR_EXPIRED_LINK");
    await db.query(`UPDATE users SET email_verified_at = coalesce(email_verified_at, now()), updated_at = now() WHERE id = $1`, [userId]);
  });
}

/** Sends a fresh verification email to the signed-in (unverified) user. */
export async function resendVerification(request: Request) {
  strictOrigin(request);
  const user = await sessionUser(request, { allowUnverified: true });
  if (!user) throw new UserError(401, "SIGN_IN_REQUIRED");
  if (user.verified) return;
  if (!await allow("resend-verify", user.id, 2)) throw new UserError(429, "RATE_LIMITED");
  const token = await createToken(pool as never, user.id, "verify");
  try { await sendVerificationEmail(user.email, user.name, token); }
  catch (error) { console.warn("verification email failed:", (error as Error)?.message?.slice(0, 200)); throw new UserError(503, "EMAIL_SEND_FAILED"); }
}

/** Always answers the same way, so it can't be used to learn which emails have accounts. */
export async function forgotPassword(request: Request, raw: unknown) {
  strictOrigin(request);
  const { email } = emailSchema.parse(raw);
  if (!await allow("forgot-ip", clientKey(request), 10) || !await allow("forgot-email", email, 3)) throw new UserError(429, "RATE_LIMITED");
  const row = (await pool.query(
    `SELECT u.id FROM users u JOIN user_credentials c ON c.user_id = u.id WHERE lower(u.email) = $1`, [email])).rows[0];
  if (!row) return;
  const token = await createToken(pool as never, row.id, "reset");
  // Not awaited: a slow mail provider must not make "known" and "unknown" emails distinguishable.
  void sendResetEmail(email, token).catch(error => console.warn("reset email failed:", (error as Error)?.message?.slice(0, 200)));
}

/** Spends a reset token, sets the new password, and signs the account out everywhere. */
export async function resetPassword(request: Request, raw: unknown) {
  strictOrigin(request);
  if (!await allow("reset", clientKey(request), 10)) throw new UserError(429, "RATE_LIMITED");
  const { token, password } = resetSchema.parse(raw);
  if (passwordProblem(password)) throw new UserError(422, "WEAK_PASSWORD");
  const hash = await hashPassword(password);
  await transaction(async db => {
    const userId = await consumeToken(db, token, "reset");
    if (!userId) throw new UserError(400, "INVALID_OR_EXPIRED_LINK");
    await db.query(`UPDATE user_credentials SET password_hash = $2, failed_attempts = 0, locked_until = NULL, updated_at = now() WHERE user_id = $1`, [userId, hash]);
    // Receiving the email proves the inbox is theirs.
    await db.query(`UPDATE users SET email_verified_at = coalesce(email_verified_at, now()), updated_at = now() WHERE id = $1`, [userId]);
    await revokeAll(db as never, userId);
  });
}

/** Changes the signed-in user's password; every other session is signed out, this one stays. */
export async function changePassword(request: Request, raw: unknown) {
  const user = await requireUser(request, true);
  const { current, next } = changeSchema.parse(raw);
  if (!await allow("pw-change", user.id, 5)) throw new UserError(429, "RATE_LIMITED");
  if (passwordProblem(next)) throw new UserError(422, "WEAK_PASSWORD");
  const row = (await pool.query(`SELECT password_hash FROM user_credentials WHERE user_id = $1`, [user.id])).rows[0];
  if (!row || !await verifyPassword(current, row.password_hash)) throw new UserError(403, "WRONG_PASSWORD");
  if (current === next) throw new UserError(422, "SAME_PASSWORD");
  const hash = await hashPassword(next);
  const cookie = request.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${USER_COOKIE}=([a-f0-9]{64})(?:;|$)`))?.[1];
  await transaction(async db => {
    await db.query(`UPDATE user_credentials SET password_hash = $2, failed_attempts = 0, locked_until = NULL, updated_at = now() WHERE user_id = $1`, [user.id, hash]);
    await revokeAll(db as never, user.id, cookie ? sha(cookie) : undefined);
  });
}

/** Signs this account out on every device. */
export async function signOutEverywhere(request: Request) {
  const user = await requireUser(request, true);
  await revokeAll(pool, user.id);
}
