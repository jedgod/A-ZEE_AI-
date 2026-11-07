import "server-only";
import { randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { pool } from "@/lib/admin/db";

// Soft protection for the free plan against one person running many accounts.
//
// Principles:
//  * Only signals that identify a device count as a link: the server-issued device cookie, or a
//    matching browser fingerprint *and* network prefix. An IP address on its own never links
//    accounts (shared Wi-Fi, campus and carrier networks would produce false positives).
//  * The only consequence is the free-plan upgrade wall, never a ban, and an administrator can
//    clear any account. Linked accounts' identities are never shown to users.
//  * Signals are kept 90 days, and are disclosed in the privacy notice.

export const DEVICE_COOKIE = "az_dev";
export const WINDOW_DAYS = 30;
export const RETENTION_DAYS = 90;
/** Linked accounts that already used up their free allowance before this one is walled (default 2). */
export const clusterLimit = () => Math.max(1, Number(process.env.FREE_CLUSTER_LIMIT) || 2);

// ---- request signals ----

/** The client IP, only through a trusted proxy (the same rule as rate limiting); otherwise unknown. */
export function clientIp(request: Request): string | null {
  if (process.env.TRUST_PROXY !== "true") return null;
  const candidate = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip") ?? "";
  return isIP(candidate) ? candidate : null;
}

export function clientInfo(request: Request) {
  const userAgent = (request.headers.get("user-agent") ?? "").slice(0, 300);
  const hints = request.headers.get("sec-ch-ua-mobile");
  const deviceType: "desktop" | "mobile" | "tablet" = /ipad|tablet/i.test(userAgent) ? "tablet" : hints === "?1" || /mobile|android|iphone/i.test(userAgent) ? "mobile" : "desktop";
  return { ip: clientIp(request), userAgent, deviceType };
}

/** The browser's long-lived device id. The server issues it, so a client can't choose its own. */
export function deviceCookie(request: Request): { id: string; setCookie: string | null } {
  // The mobile app has no cookie jar to rely on: it keeps its own random install id and sends it.
  const installId = request.headers.get("x-az-client") === "mobile" ? request.headers.get("x-az-device")?.match(/^[a-f0-9]{32}$/)?.[0] : undefined;
  if (installId) return { id: installId, setCookie: null };
  const existing = request.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${DEVICE_COOKIE}=([a-f0-9]{32})(?:;|$)`))?.[1];
  if (existing) return { id: existing, setCookie: null };
  const id = randomBytes(16).toString("hex");
  const secure = (process.env.APP_ORIGIN ?? "").startsWith("https://") ? "; Secure" : "";
  return { id, setCookie: `${DEVICE_COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${2 * 365 * 86400}${secure}` };
}

/** A client-computed hash; only well-formed values are kept, and they're treated as a hint. */
export const fingerprintOf = (value: unknown): string | null => (typeof value === "string" && /^[a-f0-9]{64}$/.test(value) ? value : null);

// ---- recording ----

export type SignalAction = "signup" | "login" | "free_usage";

export async function recordSignal(request: Request, userId: string | null, action: SignalAction, fingerprint: unknown, cookieId: string | null) {
  const { ip, userAgent, deviceType } = clientInfo(request);
  if (action === "free_usage" && userId) {
    // Repeated pings from the same device in an hour add nothing.
    const recent = await pool.query(
      `SELECT 1 FROM device_signals WHERE user_id = $1 AND action = 'free_usage' AND cookie_id IS NOT DISTINCT FROM $2 AND created_at > now() - interval '1 hour' LIMIT 1`, [userId, cookieId]);
    if (recent.rowCount) return null;
  }
  const r = await pool.query(
    `INSERT INTO device_signals (user_id, ip_address, user_agent, device_type, fingerprint, cookie_id, action)
     VALUES ($1, $2::inet, $3, $4, $5, $6, $7) RETURNING id`,
    [userId, ip, userAgent || null, deviceType, fingerprintOf(fingerprint), cookieId, action]);
  return r.rows[0].id as string;
}

/** Sign-up and sign-in call this: records the device, re-evaluates the account, never throws. */
export async function trackAuth(request: Request, userId: string, action: "signup" | "login", body: unknown): Promise<string | null> {
  const device = deviceCookie(request);
  try {
    await recordSignal(request, userId, action, (body as { fingerprint?: unknown } | null)?.fingerprint, device.id);
    await evaluateUser(userId);
  } catch (error) { console.warn("device signal failed:", (error as Error).message?.slice(0, 120)); }
  return device.setCookie;
}

// ---- linking ----

const PREFIX = `network(set_masklen(ip_address, CASE family(ip_address) WHEN 4 THEN 24 ELSE 48 END))`;

export type Link = { userId: string; reasons: ("device cookie" | "fingerprint and network")[]; exhausted: boolean };

/** Other accounts that share a device cookie, or a fingerprint within the same network, in the last 30 days. */
export async function linkedFor(userId: string): Promise<Link[]> {
  const r = await pool.query(
    `WITH me AS (
       SELECT fingerprint, cookie_id, ${PREFIX} AS prefix FROM device_signals
       WHERE user_id = $1 AND created_at > now() - make_interval(days => $2)
     ), others AS (
       SELECT user_id, fingerprint, cookie_id, ${PREFIX} AS prefix FROM device_signals
       WHERE user_id IS NOT NULL AND user_id <> $1 AND created_at > now() - make_interval(days => $2)
     )
     SELECT o.user_id,
            bool_or(o.cookie_id = m.cookie_id) AS by_cookie,
            bool_or(o.fingerprint = m.fingerprint AND o.prefix = m.prefix) AS by_fingerprint,
            EXISTS (SELECT 1 FROM free_quota_events f WHERE f.user_id = o.user_id AND f.exhausted_at > now() - make_interval(days => $2)) AS exhausted
     FROM others o JOIN me m ON o.cookie_id = m.cookie_id OR (o.fingerprint = m.fingerprint AND o.prefix = m.prefix)
     GROUP BY o.user_id LIMIT 50`, [userId, WINDOW_DAYS]);
  return r.rows.map(row => ({
    userId: row.user_id as string,
    reasons: [...(row.by_cookie ? ["device cookie" as const] : []), ...(row.by_fingerprint ? ["fingerprint and network" as const] : [])],
    exhausted: Boolean(row.exhausted),
  }));
}

/** Recomputes this account's wall. An administrator's "allow" always wins. */
export async function evaluateUser(userId: string): Promise<{ walled: boolean; linked: number; exhausted: number }> {
  const links = await linkedFor(userId);
  const exhausted = links.filter(l => l.exhausted).length;
  const r = await pool.query(
    `INSERT INTO abuse_flags (user_id, walled, linked_accounts, exhausted_linked) VALUES ($1, $2::int >= $3::int, $4::int, $2::int)
     ON CONFLICT (user_id) DO UPDATE SET walled = (NOT abuse_flags.allowed) AND EXCLUDED.exhausted_linked >= $3::int,
       linked_accounts = EXCLUDED.linked_accounts, exhausted_linked = EXCLUDED.exhausted_linked, evaluated_at = now()
     RETURNING walled`, [userId, exhausted, clusterLimit(), links.length]);
  return { walled: Boolean(r.rows[0].walled), linked: links.length, exhausted };
}

/** Called when a free account uses up its allowance; accounts linked to it are re-evaluated. */
export async function markQuotaExhausted(userId: string, feature: string) {
  const recent = await pool.query(`SELECT 1 FROM free_quota_events WHERE user_id = $1 AND exhausted_at > now() - interval '1 day' LIMIT 1`, [userId]);
  if (recent.rowCount) return;
  await pool.query(`INSERT INTO free_quota_events (user_id, feature) VALUES ($1, $2)`, [userId, feature]);
  for (const link of await linkedFor(userId)) await evaluateUser(link.userId).catch(() => undefined);
}

/** Whether the free-plan upgrade wall applies to this account right now. */
export async function isWalled(userId: string): Promise<boolean> {
  try {
    const r = await pool.query(`SELECT walled FROM abuse_flags WHERE user_id = $1`, [userId]);
    return Boolean(r.rows[0]?.walled);
  } catch { return false; } // never block anyone because the signals table is unavailable
}

/** What the user may know: whether a wall applies, never who else is linked. */
export async function statusFor(userId: string) {
  const flags = (await pool.query(`SELECT walled, linked_accounts FROM abuse_flags WHERE user_id = $1`, [userId])).rows[0];
  return { walled: Boolean(flags?.walled), linkedAccounts: Number(flags?.linked_accounts ?? 0) };
}

// ---- administrators ----

const like = (q: string) => `%${q.replace(/[\\%_]/g, m => `\\${m}`)}%`;

export async function listFlagged(q = "") {
  const r = await pool.query(
    `SELECT f.user_id, u.email, u.name, f.walled, f.allowed, f.note, f.linked_accounts, f.exhausted_linked, f.evaluated_at
     FROM abuse_flags f JOIN users u ON u.id = f.user_id
     WHERE (f.linked_accounts > 0 OR f.allowed) AND ($1 = '' OR u.email ILIKE $2 ESCAPE '\\' OR u.name ILIKE $2 ESCAPE '\\')
     ORDER BY f.walled DESC, f.exhausted_linked DESC, f.evaluated_at DESC LIMIT 100`, [q, like(q)]);
  const rows = [];
  for (const row of r.rows.slice(0, 50)) {
    const links = await linkedFor(row.user_id);
    const names = links.length ? (await pool.query(`SELECT id, email FROM users WHERE id = ANY($1::text[])`, [links.map(l => l.userId)])).rows : [];
    rows.push({
      userId: row.user_id as string, email: row.email as string, name: row.name as string, walled: row.walled as boolean, allowed: row.allowed as boolean,
      note: (row.note as string | null) ?? null, linked: row.linked_accounts as number, exhaustedLinked: row.exhausted_linked as number, evaluatedAt: new Date(row.evaluated_at).toISOString(),
      links: links.map(l => ({ email: names.find(n => n.id === l.userId)?.email ?? (l.userId.startsWith("deleted:") ? "deleted account" : "unknown"), reasons: l.reasons, exhausted: l.exhausted })),
    });
  }
  return rows;
}

/** Allow (clear the wall) or restore automatic handling for one account. */
export async function setAllowed(userId: string, allowed: boolean, note: string | null) {
  if (!(await pool.query(`SELECT 1 FROM users WHERE id = $1`, [userId])).rowCount) return false;
  const r = await pool.query(
    `INSERT INTO abuse_flags (user_id, allowed, walled, note) VALUES ($1, $2, false, $3)
     ON CONFLICT (user_id) DO UPDATE SET allowed = $2, walled = CASE WHEN $2 THEN false ELSE abuse_flags.walled END, note = $3, evaluated_at = now()
     RETURNING user_id`, [userId, allowed, note]);
  if (!allowed) await evaluateUser(userId);
  return r.rowCount === 1;
}

const csvCell = (value: unknown) => {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // a spreadsheet would run this as a formula
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The flagged-accounts list as CSV for an administrator's spreadsheet (no raw IPs or fingerprints). */
export function flaggedCsv(rows: Awaited<ReturnType<typeof listFlagged>>): string {
  const head = ["name", "email", "status", "linked_accounts", "linked_that_used_free_allowance", "linked_emails", "last_evaluated", "note"];
  const body = rows.map(r => [
    r.name, r.email, r.walled ? "upgrade wall" : r.allowed ? "cleared by admin" : "watching", r.linked, r.exhaustedLinked,
    r.links.map(l => l.email).join("; "), r.evaluatedAt, r.note ?? "",
  ].map(csvCell).join(","));
  return [head.join(","), ...body].join("\n");
}

/** Retention: signals older than 90 days are deleted. */
export async function purgeOldSignals(): Promise<number> {
  const r = await pool.query(`DELETE FROM device_signals WHERE created_at < now() - make_interval(days => $1)`, [RETENTION_DAYS]);
  await pool.query(`DELETE FROM free_quota_events WHERE exhausted_at < now() - make_interval(days => $1)`, [RETENTION_DAYS]);
  return r.rowCount ?? 0;
}
