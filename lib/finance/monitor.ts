import "server-only";
import { pool } from "@/lib/admin/db";

// "Monitor this for me": rules a signed-in user sets, kept in A-Zee's PostgreSQL and checked by lib/finance/monitor-worker.ts.
// Alerts use the same delayed, informational quotes as the Markets page. They are not advice and not a licensed feed.

export const RULE_TYPES = ["pct_drop_24h", "pct_rise_24h", "price_below", "price_above"] as const;
export const RULE_CLASSES = ["stocks_etfs", "crypto", "forex", "commodities"] as const;
export type RuleType = (typeof RULE_TYPES)[number];
export type RuleClass = (typeof RULE_CLASSES)[number];
export const RECURRENCES = ["once", "each_crossing"] as const;
export type Recurrence = (typeof RECURRENCES)[number];
export const MAX_RULES_PER_USER = 15;
const COLS = "id, symbol, asset_class, rule_type, threshold, recurrence, status, last_checked_at, last_price, last_change_pct, last_source, last_quote_as_of, stale_reason, triggered_at, created_at";
const ALERT_COLS = "id, rule_id, symbol, message, observed_price, source, rule_type, threshold, recurrence, quote_as_of, change_pct, created_at";
export const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9._/=-]{0,19}$/;

export class MonitorError extends Error {
  constructor(public status: number, public code: string) { super(code); this.name = "MonitorError"; }
}

type Db = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }> };

/** Only crypto (CoinGecko) and keyed stock sources report a 24-hour change; forex and commodities do not, so a percent rule could never fire. */
export const supportsPercent = (assetClass: RuleClass) => assetClass === "crypto" || assetClass === "stocks_etfs";

export function validateRule(input: { symbol: string; assetClass: RuleClass; ruleType: RuleType; threshold: number; recurrence?: Recurrence }) {
  const symbol = input.symbol.trim().toUpperCase();
  if (!SYMBOL_PATTERN.test(symbol)) throw new MonitorError(400, "INVALID_SYMBOL");
  if (!Number.isFinite(input.threshold) || input.threshold <= 0 || input.threshold > 1e12) throw new MonitorError(400, "INVALID_THRESHOLD");
  if (input.ruleType.startsWith("pct_")) {
    if (!supportsPercent(input.assetClass)) throw new MonitorError(400, "PERCENT_NOT_SUPPORTED");
    if (input.threshold > 100) throw new MonitorError(400, "INVALID_THRESHOLD");
  }
  if (input.recurrence !== undefined && !RECURRENCES.includes(input.recurrence)) throw new MonitorError(400, "INVALID_REQUEST");
  return { ...input, symbol, recurrence: input.recurrence ?? ("once" as Recurrence) };
}

export async function listRules(userId: string, db: Db = pool) {
  const [rules, alerts] = await Promise.all([
    db.query(`SELECT ${COLS} FROM monitor_rules WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30`, [userId]),
    db.query(`SELECT ${ALERT_COLS} FROM alert_events WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30`, [userId]),
  ]);
  return { rules: rules.rows, alerts: alerts.rows };
}

type Pool = { connect: () => Promise<Db & { release: () => void }> };

/** The cap is enforced under a per-account lock inside one transaction, so many quick taps (or two devices) cannot slip past it. */
export async function createRule(userId: string, raw: { symbol: string; assetClass: RuleClass; ruleType: RuleType; threshold: number; recurrence?: Recurrence }, db: Pool = pool as unknown as Pool) {
  const r = validateRule(raw);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`monitor_rules:${userId}`]);
    const have = (await client.query(`SELECT count(*)::int AS n FROM monitor_rules WHERE user_id = $1`, [userId])).rows[0].n as number;
    if (have >= MAX_RULES_PER_USER) { await client.query("ROLLBACK"); throw new MonitorError(429, "RULE_LIMIT_REACHED"); }
    const out = await client.query(
      `INSERT INTO monitor_rules (user_id, symbol, asset_class, rule_type, threshold, recurrence) VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${COLS}`,
      [userId, r.symbol, r.assetClass, r.ruleType, r.threshold, r.recurrence]);
    await client.query("COMMIT");
    return out.rows[0];
  } catch (e) {
    if (!(e instanceof MonitorError)) await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally { client.release(); }
}

export async function setRuleStatus(userId: string, id: string, status: "active" | "paused", db: Db = pool) {
  const out = await db.query(
    `UPDATE monitor_rules SET status = $3, stale_reason = NULL WHERE id = $1 AND user_id = $2
     RETURNING ${COLS}`,
    [id, userId, status]);
  if (!out.rows[0]) throw new MonitorError(404, "NOT_FOUND");
  return out.rows[0];
}

/** Edit a rule's condition. The rule is re-armed from scratch: a new baseline, no stale or triggered state. */
export async function updateRule(userId: string, id: string, patch: { ruleType?: RuleType; threshold?: number; recurrence?: Recurrence }, db: Db = pool) {
  const cur = (await db.query(`SELECT symbol, asset_class, rule_type, threshold::float AS threshold, recurrence FROM monitor_rules WHERE id = $1 AND user_id = $2`, [id, userId])).rows[0];
  if (!cur) throw new MonitorError(404, "NOT_FOUND");
  const next = validateRule({ symbol: cur.symbol, assetClass: cur.asset_class, ruleType: patch.ruleType ?? cur.rule_type, threshold: patch.threshold ?? cur.threshold, recurrence: patch.recurrence ?? cur.recurrence });
  const out = await db.query(
    `UPDATE monitor_rules SET rule_type = $3, threshold = $4, recurrence = $5, status = 'active', stale_reason = NULL, triggered_at = NULL, condition_met = NULL
     WHERE id = $1 AND user_id = $2 RETURNING ${COLS}`,
    [id, userId, next.ruleType, next.threshold, next.recurrence]);
  if (!out.rows[0]) throw new MonitorError(404, "NOT_FOUND");
  return out.rows[0];
}

export async function deleteRule(userId: string, id: string, db: Db = pool) {
  const out = await db.query(`DELETE FROM monitor_rules WHERE id = $1 AND user_id = $2 RETURNING id`, [id, userId]);
  if (!out.rows[0]) throw new MonitorError(404, "NOT_FOUND");
  return { id };
}

export const PUSH_TOKEN = /^Expo(?:nent)?PushToken\[[A-Za-z0-9_-]{8,160}\]$/;

export async function saveDeviceToken(userId: string, token: string, platform: "android" | "ios", db: Db = pool) {
  if (!PUSH_TOKEN.test(token)) throw new MonitorError(400, "INVALID_TOKEN");
  // A token belongs to one account at a time: if the phone signs in as someone else, it moves.
  await db.query(
    `INSERT INTO user_push_tokens (user_id, expo_push_token, platform) VALUES ($1, $2, $3)
     ON CONFLICT (expo_push_token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, updated_at = now()`,
    [userId, token, platform]);
}

export async function removeDeviceToken(userId: string, token: string, db: Db = pool) {
  await db.query(`DELETE FROM user_push_tokens WHERE user_id = $1 AND expo_push_token = $2`, [userId, token]);
}
