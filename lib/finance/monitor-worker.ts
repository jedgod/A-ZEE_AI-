import "server-only";
import { pool } from "@/lib/admin/db";
import { ollamaOnly } from "@/lib/pipeline/privacy";
import { fetchQuoteBatch, type BatchItem, type BatchResult } from "./batch";
import type { RuleClass, RuleType } from "./monitor";

/**
 * The evaluator behind "Monitor this for me". One call = one cycle:
 *   - only one cycle runs at a time (a PostgreSQL advisory lock), so overlapping ticks cannot double-process;
 *   - rules are grouped by symbol so each quote is fetched once, and the shared quote cache keeps free APIs calm;
 *   - a rule never fires on bad data: a failed lookup, a non-positive price, an old quote, or a missing 24-hour change marks the
 *     rule "stale_feed" with the reason, and it recovers on its own when a good quote returns;
 *   - at most one alert per rule per UTC day (alert_events.trigger_key is UNIQUE), whatever restarts or retries happen;
 *   - delivery: an in-app notification (the bell) in the same transaction as the alert, then a best-effort Expo push.
 * Prices are delayed and informational. Nothing here places an order.
 */

const LOCK_KEY = 4815162342;
const MAX_RULES_PER_CYCLE = 200;
const MAX_QUOTE_AGE_MS = 5 * 24 * 3600 * 1000;

type Client = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }>; release: () => void };
export type WorkerDeps = {
  db: { connect: () => Promise<Client> };
  quotes: (items: BatchItem[]) => Promise<BatchResult[]>;
  push: (client: Client, userId: string, title: string, body: string, ruleId: string) => Promise<boolean>;
  now: () => Date;
  privateMode: () => boolean;
};
export type CycleSummary = { skipped: boolean; evaluated: number; triggered: number; stale: number };

export type RuleRow = { id: string; user_id: string; symbol: string; asset_class: RuleClass; rule_type: RuleType; threshold: string; recurrence?: "once" | "each_crossing"; condition_met?: boolean | null };
const MAX_CROSSING_ALERTS_PER_DAY = 5;

const STALE_REASONS: Record<string, string> = {
  PROVIDER_NOT_CONFIGURED: "No data source is set up for this asset on the server",
  QUOTE_UNAVAILABLE: "The price feed returned no quote",
  FUTURES_NOT_CONFIGURED: "Futures are not supported yet",
  EXTERNAL_DATA_DISABLED: "Paused while the server is in private mode",
  INVALID_SYMBOL: "That symbol is not valid",
};

export const parseChange = (raw?: string): number | null => {
  if (!raw) return null;
  const n = Number(raw.replace("%", "").replace("+", "").trim());
  return Number.isFinite(n) ? n : null;
};
const fmtPrice = (price: number, assetClass: RuleClass) =>
  assetClass === "forex" ? price.toFixed(4) : `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: price < 1 ? 4 : 2 })}`;

export function evaluateRule(rule: RuleRow, price: number, changePct: number | null): { triggered: boolean; summary: string } {
  const t = Number(rule.threshold);
  const now = fmtPrice(price, rule.asset_class);
  switch (rule.rule_type) {
    case "pct_drop_24h": return changePct != null && changePct <= -t ? { triggered: true, summary: `${rule.symbol} fell ${Math.abs(changePct).toFixed(2)}% in 24h (your rule: ${t}% or more). Now ${now}.` } : { triggered: false, summary: "" };
    case "pct_rise_24h": return changePct != null && changePct >= t ? { triggered: true, summary: `${rule.symbol} rose ${changePct.toFixed(2)}% in 24h (your rule: ${t}% or more). Now ${now}.` } : { triggered: false, summary: "" };
    case "price_below": return price <= t ? { triggered: true, summary: `${rule.symbol} is at ${now}, at or below your ${fmtPrice(t, rule.asset_class)} rule.` } : { triggered: false, summary: "" };
    case "price_above": return price >= t ? { triggered: true, summary: `${rule.symbol} is at ${now}, at or above your ${fmtPrice(t, rule.asset_class)} rule.` } : { triggered: false, summary: "" };
    default: return { triggered: false, summary: "" };
  }
}

/** Best-effort Expo push to every device the user has registered. A dead token is removed. Needs the app to register tokens (a native build step). */
export async function sendExpoPush(client: Client, userId: string, title: string, body: string, ruleId: string): Promise<boolean> {
  const tokens: string[] = (await client.query(`SELECT expo_push_token FROM user_push_tokens WHERE user_id = $1 LIMIT 10`, [userId])).rows.map(r => r.expo_push_token);
  if (!tokens.length) return false;
  try {
    const res = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, redirect: "error", signal: AbortSignal.timeout(8000),
      body: JSON.stringify(tokens.map(to => ({ to, sound: "default", title, body, data: { type: "aztrade_monitor_alert", ruleId } }))),
    });
    if (!res.ok) return false;
    const out = await res.json().catch(() => null) as { data?: { status?: string; details?: { error?: string } }[] } | null;
    const dead = tokens.filter((_, i) => out?.data?.[i]?.details?.error === "DeviceNotRegistered");
    if (dead.length) await client.query(`DELETE FROM user_push_tokens WHERE expo_push_token = ANY($1::text[])`, [dead]);
    return (out?.data ?? []).some(t => t.status === "ok");
  } catch { return false; }
}

const defaults = (): WorkerDeps => ({ db: pool as never, quotes: fetchQuoteBatch, push: sendExpoPush, now: () => new Date(), privateMode: ollamaOnly });

export async function runMonitorCycle(deps: WorkerDeps = defaults()): Promise<CycleSummary> {
  const client = await deps.db.connect();
  try {
    if (!(await client.query("SELECT pg_try_advisory_lock($1) AS ok", [LOCK_KEY])).rows[0]?.ok) return { skipped: true, evaluated: 0, triggered: 0, stale: 0 };
    try { return await cycle(client, deps); }
    finally { await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => undefined); }
  } finally { client.release(); }
}

async function cycle(client: Client, deps: WorkerDeps): Promise<CycleSummary> {
  // Private (ollama-only) mode: no market API call leaves the server, so nothing can be checked. Say so on each rule.
  if (deps.privateMode()) {
    const r = await client.query(`UPDATE monitor_rules SET status = 'stale_feed', stale_reason = 'Paused while the server is in private mode' WHERE status = 'active'`);
    return { skipped: false, evaluated: 0, triggered: 0, stale: r.rowCount ?? 0 };
  }
  const rules: RuleRow[] = (await client.query(
    `SELECT id, user_id, symbol, asset_class, rule_type, threshold, recurrence, condition_met FROM monitor_rules WHERE status IN ('active', 'stale_feed') ORDER BY last_checked_at NULLS FIRST, created_at LIMIT $1`, [MAX_RULES_PER_CYCLE])).rows;
  if (!rules.length) return { skipped: false, evaluated: 0, triggered: 0, stale: 0 };

  const wanted = [...new Map(rules.map(r => [`${r.asset_class}:${r.symbol}`, { symbol: r.symbol, assetClass: r.asset_class }])).values()];
  const got = new Map<string, BatchResult>();
  for (let i = 0; i < wanted.length; i += 25) for (const x of await deps.quotes(wanted.slice(i, i + 25))) got.set(`${x.assetClass}:${x.symbol.toUpperCase()}`, x);

  const now = deps.now();
  const day = now.toISOString().slice(0, 10);
  let triggered = 0, stale = 0;
  for (const rule of rules) {
    const res = got.get(`${rule.asset_class}:${rule.symbol}`);
    const q = res?.quote;
    const price = Number(q?.price);
    const changePct = parseChange(q?.changePercent);
    const asOfMs = q?.asOf ? Date.parse(q.asOf) : NaN;
    const reason =
      !q ? (STALE_REASONS[res?.error ?? ""] ?? "No quote available")
      : !Number.isFinite(price) || price <= 0 ? "The price feed returned no valid price"
      : Number.isFinite(asOfMs) && now.getTime() - asOfMs > MAX_QUOTE_AGE_MS ? "The latest quote is more than 5 days old"
      : rule.rule_type.startsWith("pct_") && changePct == null ? `This source does not report a 24-hour change for ${rule.symbol}`
      : null;
    if (reason) {
      stale += 1;
      await client.query(`UPDATE monitor_rules SET status = 'stale_feed', stale_reason = $2, last_checked_at = $3 WHERE id = $1 AND status IN ('active', 'stale_feed')`, [rule.id, reason, now]);
      continue;
    }
    const source = `${q!.provider} (delayed)`;
    const quoteAsOf = Number.isFinite(asOfMs) ? new Date(asOfMs) : null;
    const { triggered: hit, summary } = evaluateRule(rule, price, changePct);
    const crossing = rule.recurrence === "each_crossing";

    // "Each crossing" alerts on the step from not-met to met, never while the price merely stays beyond the level. The first
    // check only sets the baseline. "Once" alerts as soon as the condition is met, then waits to be re-armed.
    const fire = crossing ? hit && rule.condition_met === false : hit;
    if (!fire) {
      await client.query(
        `UPDATE monitor_rules SET status = 'active', stale_reason = NULL, last_checked_at = $2, last_price = $3, last_change_pct = $4, last_source = $5, last_quote_as_of = $6, condition_met = $7 WHERE id = $1 AND status IN ('active', 'stale_feed')`,
        [rule.id, now, price, changePct, source, quoteAsOf, crossing ? hit : null]);
      continue;
    }
    const message = `${summary} Source: ${source}. Informational, not advice.`.slice(0, 500);
    const triggerKey = crossing ? `${rule.id}:x:${now.toISOString().slice(0, 16)}` : `${rule.id}:${day}`;
    let alertId: string | null = null;
    await client.query("BEGIN");
    try {
      // A rule that flaps around its level cannot flood the bell: at most a few crossing alerts per rule per day.
      const capped = crossing && Number((await client.query(`SELECT count(*)::int AS n FROM alert_events WHERE rule_id = $1 AND created_at >= $2`, [rule.id, `${day}T00:00:00Z`])).rows[0].n) >= MAX_CROSSING_ALERTS_PER_DAY;
      if (!capped) {
        const ins = await client.query(
          `INSERT INTO alert_events (rule_id, user_id, trigger_key, symbol, message, observed_price, source, rule_type, threshold, recurrence, quote_as_of, change_pct) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ON CONFLICT (trigger_key) DO NOTHING RETURNING id`,
          [rule.id, rule.user_id, triggerKey, rule.symbol, message, price, source, rule.rule_type, rule.threshold, rule.recurrence ?? "once", quoteAsOf, changePct]);
        alertId = ins.rows[0]?.id ?? null;
      }
      if (alertId) await client.query(`INSERT INTO notifications (user_id, title, body) VALUES ($1, $2, $3)`, [rule.user_id, `AZTrade alert: ${rule.symbol}`.slice(0, 120), message]);
      await client.query(
        `UPDATE monitor_rules SET status = $2, stale_reason = NULL, last_checked_at = $3, last_price = $4, last_change_pct = $5, last_source = $6, last_quote_as_of = $7, condition_met = $8, triggered_at = CASE WHEN $9 THEN $3 ELSE triggered_at END WHERE id = $1 AND status IN ('active', 'stale_feed')`,
        [rule.id, alertId && !crossing ? "triggered" : "active", now, price, changePct, source, quoteAsOf, crossing ? true : null, !!alertId]);
      await client.query("COMMIT");
    } catch (e) { await client.query("ROLLBACK").catch(() => undefined); throw e; }
    if (alertId) {
      triggered += 1;
      if (await deps.push(client, rule.user_id, `AZTrade alert: ${rule.symbol}`, message, rule.id).catch(() => false)) await client.query(`UPDATE alert_events SET push_sent = TRUE WHERE id = $1`, [alertId]);
    }
  }
  return { skipped: false, evaluated: rules.length, triggered, stale };
}
