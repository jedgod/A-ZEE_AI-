import "server-only";
import { createHash, randomBytes } from "node:crypto";

// One-time emailed tokens (verify, reset). 32 random bytes; only the sha256 is stored; a token
// works once and expires. Requesting a new one cancels the previous unused one.

type Db = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }> };
export type Purpose = "verify" | "reset";
const TTL_MINUTES: Record<Purpose, number> = { verify: 24 * 60, reset: 60 };
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createToken(db: Db, userId: string, purpose: Purpose): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.query(`DELETE FROM user_email_tokens WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`, [userId, purpose]);
  await db.query(
    `INSERT INTO user_email_tokens (token_hash, user_id, purpose, expires_at) VALUES ($1, $2, $3, now() + make_interval(mins => $4))`,
    [hash(token), userId, purpose, TTL_MINUTES[purpose]]);
  return token;
}

/** Atomically spends a valid token and returns its user, or null if it's unknown, used or expired. */
export async function consumeToken(db: Db, token: string, purpose: Purpose): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const r = await db.query(
    `UPDATE user_email_tokens SET used_at = now() WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > now() RETURNING user_id`,
    [hash(token), purpose]);
  return r.rows[0]?.user_id ?? null;
}
