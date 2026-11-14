import "server-only";
import { ollamaOnly } from "@/lib/pipeline/privacy";
import { FinanceError } from "./provider";

/**
 * Price history for the charts and the small trend lines. Delayed and informational like every quote here:
 *   crypto      CoinGecko (no key): price line + volume, or OHLC candles
 *   forex       Frankfurter / ECB (no key): daily rates, so no intraday ranges
 *   stocks/ETFs Alpaca bars or Twelve Data time series (need a key on the server)
 *   metals      Twelve Data (needs a key)
 * A source that has no data for a range says so (RANGE_NOT_AVAILABLE / PROVIDER_NOT_CONFIGURED); nothing is invented or filled in.
 */
export const RANGES = ["1D", "1W", "1M", "3M", "1Y"] as const;
export type Range = (typeof RANGES)[number];
export type HistoryClass = "crypto" | "stocks_etfs" | "forex" | "commodities";
export type Point = { t: number; c: number; o?: number; h?: number; l?: number; v?: number };
export type History = {
  symbol: string; assetClass: HistoryClass; range: Range; currency: string; points: Point[];
  hasOhlc: boolean; hasVolume: boolean; source: string; asOf: number | null; intervalMs: number | null; notice: string;
};

const NOTICE = "Delayed, informational data from a free public source. Gaps mean the source has no data there (weekends, closed markets).";
const MAX_POINTS = 240;
const TIMEOUT_MS = 10_000;
const DAY = 86_400_000;
const SYMBOL = /^[A-Z0-9][A-Z0-9._\/=-]{0,19}$/;
const enc = encodeURIComponent;
const SPAN: Record<Range, number> = { "1D": 1, "1W": 7, "1M": 30, "3M": 90, "1Y": 365 };

async function getJson(url: string, headers: Record<string, string> = {}): Promise<any | null> {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json", ...headers }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const text = await res.text();
    return text.length > 2_000_000 ? null : JSON.parse(text);
  } catch { return null; }
}
const fin = (x: unknown) => { const n = Number(x); return Number.isFinite(n) ? n : null; };

/** Keeps the first and last point and one point per bucket in between, so a year of hourly data stays light on a phone. */
export function downsample(points: Point[], max = MAX_POINTS): Point[] {
  if (points.length <= max) return points;
  const out: Point[] = [points[0]];
  const size = (points.length - 2) / (max - 2);
  for (let i = 0; i < max - 2; i++) {
    const a = 1 + Math.floor(i * size), b = Math.min(points.length - 1, 1 + Math.floor((i + 1) * size));
    const bucket = points.slice(a, Math.max(a + 1, b));
    const last = bucket[bucket.length - 1];
    const o = bucket[0].o, h = bucket.every(p => p.h != null) ? Math.max(...bucket.map(p => p.h as number)) : undefined, l = bucket.every(p => p.l != null) ? Math.min(...bucket.map(p => p.l as number)) : undefined;
    const v = bucket.every(p => p.v != null) ? bucket.reduce((n, p) => n + (p.v as number), 0) : undefined;
    out.push({ t: last.t, c: last.c, ...(o != null ? { o } : {}), ...(h != null ? { h } : {}), ...(l != null ? { l } : {}), ...(v != null ? { v } : {}) });
  }
  out.push(points[points.length - 1]);
  return out;
}

const COINS: Record<string, string> = { BTC: "bitcoin", ETH: "ethereum", SOL: "solana", XRP: "ripple", ADA: "cardano", DOGE: "dogecoin", LTC: "litecoin", DOT: "polkadot" };
const OHLC_DAYS = [1, 7, 14, 30, 90, 180, 365];

async function crypto(symbol: string, range: Range, candles: boolean): Promise<History> {
  const base = symbol.replace(/[-\/]USDT?$/, "");
  const id = COINS[base] ?? base.toLowerCase();
  const days = SPAN[range];
  const demo = process.env.COINGECKO_API_KEY;
  const headers: Record<string, string> = demo ? { "x-cg-demo-api-key": demo } : {};
  if (candles) {
    const d = await getJson(`https://api.coingecko.com/api/v3/coins/${enc(id)}/ohlc?vs_currency=usd&days=${OHLC_DAYS.find(x => x >= days) ?? 365}`, headers);
    const points: Point[] = (Array.isArray(d) ? d : []).map((r: number[]) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4] })).filter((p: Point) => [p.t, p.o, p.h, p.l, p.c].every(x => Number.isFinite(x)));
    if (points.length < 2) throw new FinanceError(503, "QUOTE_UNAVAILABLE");
    return build(symbol, "crypto", range, "USD", downsample(points), "coingecko", true, false);
  }
  const d = await getJson(`https://api.coingecko.com/api/v3/coins/${enc(id)}/market_chart?vs_currency=usd&days=${days}`, headers);
  const prices: number[][] = Array.isArray(d?.prices) ? d.prices : [];
  const volumes: number[][] = Array.isArray(d?.total_volumes) ? d.total_volumes : [];
  const points: Point[] = prices.map((p, i) => ({ t: p[0], c: p[1], ...(Number.isFinite(volumes[i]?.[1]) ? { v: volumes[i][1] } : {}) })).filter(p => Number.isFinite(p.t) && Number.isFinite(p.c) && p.c > 0);
  if (points.length < 2) throw new FinanceError(503, "QUOTE_UNAVAILABLE");
  return build(symbol, "crypto", range, "USD", downsample(points), "coingecko", false, points.some(p => p.v != null));
}

async function forex(pair: string, range: Range): Promise<History> {
  if (range === "1D") throw new FinanceError(422, "RANGE_NOT_AVAILABLE");   // the ECB publishes one rate a day
  const clean = pair.replace(/[\/-]/g, "");
  const base = clean.slice(0, 3), to = clean.slice(3, 6) || "USD";
  if (!/^[A-Z]{3}$/.test(base) || !/^[A-Z]{3}$/.test(to)) throw new FinanceError(400, "INVALID_SYMBOL");
  const end = new Date(), start = new Date(end.getTime() - SPAN[range] * DAY);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const d = await getJson(`https://api.frankfurter.dev/v1/${iso(start)}..${iso(end)}?base=${base}&symbols=${to}`);
  const rates = d?.rates && typeof d.rates === "object" ? d.rates as Record<string, Record<string, number>> : {};
  const points: Point[] = Object.keys(rates).sort().map(day => ({ t: Date.parse(`${day}T00:00:00Z`), c: Number(rates[day]?.[to]) })).filter(p => Number.isFinite(p.t) && Number.isFinite(p.c) && p.c > 0);
  if (points.length < 2) throw new FinanceError(503, "QUOTE_UNAVAILABLE");
  return build(`${base}/${to}`, "forex", range, to, downsample(points), "frankfurter-ecb", false, false);
}

const TD_INTERVAL: Record<Range, [string, number]> = { "1D": ["5min", 80], "1W": ["30min", 70], "1M": ["1day", 30], "3M": ["1day", 70], "1Y": ["1day", 260] };
async function twelve(symbol: string, assetClass: HistoryClass, range: Range, key: string, display: string): Promise<History | null> {
  const [interval, size] = TD_INTERVAL[range];
  const d = await getJson(`https://api.twelvedata.com/time_series?symbol=${enc(symbol)}&interval=${interval}&outputsize=${size}`, { Authorization: `apikey ${key}` });
  if (!d || d.status === "error" || !Array.isArray(d.values)) return null;
  const points: Point[] = d.values.map((r: any) => ({ t: Date.parse(`${String(r.datetime).replace(" ", "T")}Z`), o: fin(r.open) ?? undefined, h: fin(r.high) ?? undefined, l: fin(r.low) ?? undefined, c: fin(r.close) as number, ...(fin(r.volume) ? { v: fin(r.volume) as number } : {}) }))
    .filter((p: Point) => Number.isFinite(p.t) && Number.isFinite(p.c) && p.c > 0).sort((a: Point, b: Point) => a.t - b.t);
  if (points.length < 2) return null;
  return build(display, assetClass, range, "USD", downsample(points), "twelvedata", points.every(p => p.o != null && p.h != null && p.l != null), points.some(p => p.v != null));
}

const AL_FRAME: Record<Range, string> = { "1D": "5Min", "1W": "30Min", "1M": "1Day", "3M": "1Day", "1Y": "1Day" };
async function alpaca(symbol: string, range: Range, key: string, secret: string): Promise<History | null> {
  const start = new Date(Date.now() - (SPAN[range] + 3) * DAY).toISOString();
  const d = await getJson(`https://data.alpaca.markets/v2/stocks/${enc(symbol)}/bars?timeframe=${AL_FRAME[range]}&start=${enc(start)}&limit=1000&feed=iex&adjustment=split`, { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret });
  const bars: any[] = Array.isArray(d?.bars) ? d.bars : [];
  const points: Point[] = bars.map(b => ({ t: Date.parse(b.t), o: fin(b.o) ?? undefined, h: fin(b.h) ?? undefined, l: fin(b.l) ?? undefined, c: fin(b.c) as number, ...(fin(b.v) ? { v: fin(b.v) as number } : {}) })).filter(p => Number.isFinite(p.t) && Number.isFinite(p.c) && p.c > 0);
  if (points.length < 2) return null;
  return build(symbol, "stocks_etfs", range, "USD", downsample(points), "alpaca", true, points.some(p => p.v != null));
}

async function stock(symbol: string, range: Range): Promise<History> {
  const { ALPACA_API_KEY: key, ALPACA_API_SECRET: secret, TWELVEDATA_API_KEY: td } = process.env;
  if (key && secret) { const h = await alpaca(symbol, range, key, secret); if (h) return h; }
  if (td) { const h = await twelve(symbol, "stocks_etfs", range, td, symbol); if (h) return h; }
  throw new FinanceError(503, (key && secret) || td ? "QUOTE_UNAVAILABLE" : "PROVIDER_NOT_CONFIGURED");
}
async function metal(raw: string, range: Range): Promise<History> {
  const stem = raw.replace(/[-\/]USD$/, "");
  const td = process.env.TWELVEDATA_API_KEY;
  if (!/^X(AU|AG|PT|PD)$/.test(stem)) throw new FinanceError(503, "PROVIDER_NOT_CONFIGURED");   // oil, gas and copper have no free history source here
  if (!td) throw new FinanceError(503, "PROVIDER_NOT_CONFIGURED");
  const h = await twelve(`${stem}/USD`, "commodities", range, td, raw);
  if (!h) throw new FinanceError(503, "QUOTE_UNAVAILABLE");
  return h;
}

function build(symbol: string, assetClass: HistoryClass, range: Range, currency: string, points: Point[], source: string, hasOhlc: boolean, hasVolume: boolean): History {
  const gaps = points.slice(1).map((p, i) => p.t - points[i].t).sort((a, b) => a - b);
  return { symbol, assetClass, range, currency, points, hasOhlc, hasVolume, source: `${source} (delayed)`, asOf: points.length ? points[points.length - 1].t : null, intervalMs: gaps.length ? gaps[Math.floor(gaps.length / 2)] : null, notice: NOTICE };
}

const CACHE_MS = 120_000;
const cache = new Map<string, { at: number; value: History | { error: FinanceError } }>();
export const clearHistoryCache = () => cache.clear();

export async function fetchHistory(rawSymbol: string, assetClass: HistoryClass, range: Range, opts: { candles?: boolean } = {}): Promise<History> {
  const symbol = rawSymbol.trim().toUpperCase();
  if (!SYMBOL.test(symbol)) throw new FinanceError(400, "INVALID_SYMBOL");
  if (!RANGES.includes(range)) throw new FinanceError(400, "INVALID_RANGE");
  if (ollamaOnly()) throw new FinanceError(503, "EXTERNAL_DATA_DISABLED");
  const key = `${assetClass}:${symbol}:${range}:${opts.candles ? "c" : "l"}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) { if ("error" in hit.value) throw hit.value.error; return hit.value; }
  try {
    const value = assetClass === "crypto" ? await crypto(symbol, range, !!opts.candles) : assetClass === "forex" ? await forex(symbol, range) : assetClass === "stocks_etfs" ? await stock(symbol, range) : await metal(symbol, range);
    if (cache.size > 300) cache.clear();
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch (e) {
    const err = e instanceof FinanceError ? e : new FinanceError(503, "QUOTE_UNAVAILABLE");
    if (cache.size > 300) cache.clear();
    cache.set(key, { at: Date.now() - CACHE_MS + 20_000, value: { error: err } });   // a failure is remembered for 20 s, not 2 minutes
    throw err;
  }
}

export type Sparkline = { symbol: string; assetClass: HistoryClass; range: Range; points: number[]; changePct: number | null; error?: string };

/** Compact trend lines (about 48 points) for a list of symbols: 24 hours, or 1 week where the source is daily (forex). */
export async function fetchSparklines(items: { symbol: string; assetClass: HistoryClass }[]): Promise<Sparkline[]> {
  const unique = [...new Map(items.slice(0, 20).map(i => [`${i.assetClass}:${i.symbol.trim().toUpperCase()}`, { symbol: i.symbol.trim().toUpperCase(), assetClass: i.assetClass }])).values()];
  const out: Sparkline[] = new Array(unique.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, unique.length) }, async () => {
    while (next < unique.length) {
      const i = next++, it = unique[i];
      const range: Range = it.assetClass === "forex" ? "1W" : "1D";
      try {
        const h = await fetchHistory(it.symbol, it.assetClass, range);
        const pts = downsample(h.points, 48).map(p => p.c);
        out[i] = { ...it, range, points: pts, changePct: pts.length > 1 ? ((pts[pts.length - 1] - pts[0]) / pts[0]) * 100 : null };
      } catch (e) { out[i] = { ...it, range, points: [], changePct: null, error: e instanceof FinanceError ? e.code : "QUOTE_UNAVAILABLE" }; }
    }
  }));
  return out;
}
