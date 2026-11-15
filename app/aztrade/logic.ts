/**
 * Pure helpers shared by the AZTrade desktop panels (no React, no fetch), so they can be unit-tested.
 * Same data model and rules as the mobile app: delayed, informational quotes; nothing here prices a trade.
 */
export type AssetClass = 'crypto' | 'stocks_etfs' | 'forex' | 'commodities';
export type Asset = { symbol: string; assetClass: AssetClass; name?: string };
export type Range = '1D' | '1W' | '1M' | '3M' | '1Y';
export const RANGES: Range[] = ['1D', '1W', '1M', '3M', '1Y'];
export type Point = { t: number; c: number; o?: number; h?: number; l?: number; v?: number };
export type History = {
  symbol: string; assetClass: AssetClass; range: Range; currency: string; points: Point[];
  hasOhlc: boolean; hasVolume: boolean; source: string; asOf: number | null; intervalMs: number | null; notice: string;
};
export type Spark = { symbol: string; assetClass: AssetClass; range: Range; points: number[]; changePct: number | null; error?: string };
export type CatalogItem = { symbol: string; name: string; assetClass: AssetClass; pair: string; live: boolean; history: boolean };
export type QuoteInfo = { price: number | null; currency: string; changePercent?: string; provider: string; asOf?: string };
export type QuoteState = Record<string, { quote?: QuoteInfo; error?: string }>;
export type RuleType = 'pct_drop_24h' | 'pct_rise_24h' | 'price_below' | 'price_above';
export type Recurrence = 'once' | 'each_crossing';
export type Rule = {
  id: string; symbol: string; asset_class: AssetClass; rule_type: RuleType; threshold: string; recurrence: Recurrence;
  status: 'active' | 'triggered' | 'paused' | 'stale_feed';
  last_checked_at: string | null; last_price: string | null; last_source: string | null; last_quote_as_of: string | null;
  stale_reason: string | null; triggered_at: string | null;
};
export type AlertRow = {
  id: string; rule_id: string; symbol: string; message: string; observed_price: string; source: string; created_at: string;
  rule_type: RuleType | null; threshold: string | null; recurrence: Recurrence | null; quote_as_of: string | null; change_pct: string | null;
};
export type WatchItem = { symbol: string; assetClass: AssetClass };

export const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9._/=-]{0,19}$/;
export const guessClass = (symbol: string): AssetClass =>
  /^X(AU|AG|PT|PD)(-USD)?$/.test(symbol) ? 'commodities' : /-USDT?$/.test(symbol) ? 'crypto' : /^[A-Z]{3}\/[A-Z]{3}$/.test(symbol) ? 'forex' : 'stocks_etfs';
export const CLASS_LABEL: Record<AssetClass, string> = { crypto: 'Crypto', stocks_etfs: 'Stock/ETF', forex: 'Forex', commodities: 'Commodity' };
export const percentOk = (c: AssetClass) => c === 'crypto' || c === 'stocks_etfs';
export const unitFor = (t: RuleType, c: AssetClass) => (t.startsWith('pct_') ? '%' : c === 'forex' ? '' : 'USD');

// ---------- formatting ----------
export const fmtPrice = (v: number, forex = false) => (forex ? v.toFixed(4) : Math.abs(v) >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(4));
export const fmtPct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
export const fmtMoney = (raw: unknown) => { const n = Number(raw); return raw == null || raw === '' || !Number.isFinite(n) ? 'Unavailable' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }); };
export const fmtNum = (x: string | number) => Number(x).toLocaleString('en-US', { maximumFractionDigits: 6 });
export function fmtTime(t: number, range: Range, intraday: boolean) {
  const d = new Date(t);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const day = d.toLocaleDateString([], { month: 'short', day: 'numeric', ...(range === '1Y' ? { year: '2-digit' } : {}) });
  return range === '1D' ? time : intraday ? `${day}, ${time}` : day;
}
export function fmtWhen(iso: string | null | undefined, empty = '—') {
  if (!iso) return empty;
  const d = new Date(iso);
  const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? t : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${t}`;
}
export const changeOf = (q?: QuoteInfo): number | null => { const n = q?.changePercent ? parseFloat(q.changePercent) : NaN; return Number.isFinite(n) ? n : null; };

export function ruleLine(r: { rule_type: RuleType; threshold: string; recurrence?: Recurrence | null }, c: AssetClass) {
  const t = r.rule_type;
  const base = t === 'price_below' ? 'Crosses below' : t === 'price_above' ? 'Crosses above' : t === 'pct_drop_24h' ? 'Drops by' : 'Rises by';
  const u = unitFor(t, c);
  return `${base} ${fmtNum(r.threshold)}${u === '%' ? '%' : u ? ` ${u}` : ''}${t.startsWith('pct_') ? ' in 24h' : ''}${r.recurrence === 'each_crossing' ? ' · each crossing' : ' · once'}`;
}

// ---------- watchlist ----------
export const DEFAULT_WATCH: WatchItem[] = [
  { symbol: 'AAPL', assetClass: 'stocks_etfs' }, { symbol: 'NVDA', assetClass: 'stocks_etfs' }, { symbol: 'TSLA', assetClass: 'stocks_etfs' },
  { symbol: 'BTC-USD', assetClass: 'crypto' }, { symbol: 'XAU-USD', assetClass: 'commodities' },
];
const CLASSES: AssetClass[] = ['crypto', 'stocks_etfs', 'forex', 'commodities'];
export function parseWatch(raw: string | null): WatchItem[] {
  if (!raw) return DEFAULT_WATCH;
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return DEFAULT_WATCH;
    const out = v.filter((i): i is WatchItem => !!i && typeof i.symbol === 'string' && SYMBOL_PATTERN.test(i.symbol) && CLASSES.includes(i.assetClass));
    return [...new Map(out.map(i => [i.symbol, i])).values()].slice(0, 50);
  } catch { return DEFAULT_WATCH; }
}

// ---------- practice-account valuation from delayed, informational prices ----------
export type Valuation = {
  cash: number; rows: { symbol: string; cls: AssetClass; qty: number; price: number | null; value: number | null }[];
  missing: string[]; complete: boolean; total: number; byClass: Record<string, number>; largest: number | null; pct: (v: number) => number;
};
/** Called complete only when every holding has a price; otherwise no totals are claimed. */
export function valuate(cash: number, positions: { symbol: string; shares: unknown }[], quotes: QuoteState, classOf: (symbol: string) => AssetClass): Valuation | null {
  if (!Number.isFinite(cash)) return null;
  const rows = positions.map(p => {
    const qty = Number(p.shares); const price = quotes[p.symbol]?.quote?.price ?? null;
    return { symbol: p.symbol, cls: classOf(p.symbol), qty, price, value: price != null && Number.isFinite(qty) ? qty * price : null };
  });
  const missing = rows.filter(r => r.value == null).map(r => r.symbol);
  const complete = missing.length === 0;
  const total = cash + rows.reduce((n, r) => n + (r.value ?? 0), 0);
  const byClass: Record<string, number> = { Cash: cash };
  for (const r of rows) if (r.value != null) { const label = r.cls === 'stocks_etfs' ? 'Equities' : r.cls === 'commodities' ? 'Commodities' : r.cls === 'crypto' ? 'Crypto' : 'Forex'; byClass[label] = (byClass[label] ?? 0) + r.value; }
  const pct = (v: number) => (total > 0 ? (100 * v) / total : 0);
  const largest = complete && rows.length && total > 0 ? (Math.max(...rows.map(r => r.value as number)) / total) * 100 : null;
  return { cash, rows, missing, complete, total, byClass, largest, pct };
}

// ---------- chart maths ----------
export function indexOfTime(pts: Point[], t: number): number | null {
  if (!pts.length || t < pts[0].t || t > pts[pts.length - 1].t) return null;
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid].t <= t) lo = mid; else hi = mid; }
  const span = pts[hi].t - pts[lo].t;
  return span > 0 ? lo + (t - pts[lo].t) / span : lo;
}
export const sma = (pts: Point[], n: number): (number | null)[] => pts.map((_, i) => (i < n - 1 ? null : pts.slice(i - n + 1, i + 1).reduce((s, p) => s + p.c, 0) / n));

/** The value range of a chart. The alert level stretches the scale only when it is close to the data; otherwise it is pinned to the edge. */
export function chartDomain(values: number[], level: number | null): { min: number; max: number; levelInside: boolean } {
  let min = Math.min(...values), max = Math.max(...values);
  const span0 = max - min || Math.abs(max) * 0.02 || 1;
  let inside = false;
  if (level != null && Number.isFinite(level) && level >= min - span0 * 0.6 && level <= max + span0 * 0.6) { min = Math.min(min, level); max = Math.max(max, level); inside = true; }
  const span = max - min || 1;
  return { min: min - span * 0.06, max: max + span * 0.06, levelInside: inside };
}

/** Zoom the visible index window [a, b] by `factor` (>1 zooms in) around a fractional anchor (0 = left edge, 1 = right edge). */
export function zoomWindow(a: number, b: number, n: number, factor: number, anchor: number): [number, number] {
  const len = Math.max(6, Math.min(n - 1, (b - a) / factor));
  const center = a + (b - a) * anchor;
  let na = center - len * anchor;
  na = Math.max(0, Math.min(n - 1 - len, na));
  return [Math.round(na), Math.round(na + len)];
}
export function panWindow(a: number, b: number, n: number, deltaIdx: number): [number, number] {
  const len = b - a;
  const na = Math.max(0, Math.min(n - 1 - len, a + deltaIdx));
  return [Math.round(na), Math.round(na + len)];
}

// ---------- research replies ----------
export type ReplyPart = { text: string; bold: boolean };
export type ReplyBlock = { kind: 'p' | 'h' | 'li' | 'note'; parts: ReplyPart[] };

const inline = (raw: string): ReplyPart[] =>
  raw.replace(/`([^`]+)`/g, '$1').replace(/__(.+?)__/g, '**$1**').split(/\*\*(.+?)\*\*/g)
    .map((text, i) => ({ text, bold: i % 2 === 1 })).filter(p => p.text.length > 0);

/**
 * The model answers in light Markdown. This turns it into blocks the page can lay out: every bullet on its own
 * line, bold labels kept, headings and the closing disclaimer (a line wrapped in single asterisks) set apart.
 * Bullets that arrive run together on one line ("• A • B") are split.
 */
export function parseReply(text: string): ReplyBlock[] {
  const blocks: ReplyBlock[] = [];
  for (const rawLine of text.replace(/\r/g, '').split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) { blocks.push({ kind: 'h', parts: inline(heading[1]) }); continue; }
    const italic = /^\*(?!\*|\s)(.+?)\*$/.exec(line) ?? /^_(?!_)(.+?)_$/.exec(line);
    if (italic) { blocks.push({ kind: 'note', parts: inline(italic[1]) }); continue; }
    const bullet = /^(?:[-*\u2022]\s+)(.*)$/.exec(line);
    if (bullet || /\s\u2022\s/.test(line)) {
      for (const item of (bullet ? bullet[1] : line).split(/\s+\u2022\s+/).map(x => x.replace(/^\u2022\s*/, '').trim()).filter(Boolean)) blocks.push({ kind: 'li', parts: inline(item) });
      continue;
    }
    blocks.push({ kind: 'p', parts: inline(line) });
  }
  return blocks;
}
