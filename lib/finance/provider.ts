import "server-only";
import { ollamaOnly } from "@/lib/pipeline/privacy";

/**
 * Informational multi-asset quotes for A-Zee's "Try Finance". These come from public/free developer APIs: they may be delayed,
 * are not licensed for trading or redistribution, and must never feed AZTrade, whose market data stays fail-closed until a
 * licensed provider is registered. Every result says where it came from.
 */
export const ASSET_CLASSES = ["stocks_etfs", "crypto", "forex", "commodities", "options", "futures"] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

export type MarketQuote = {
  symbol: string;
  assetClass: AssetClass;
  price: number | null;
  currency: string;
  changePercent?: string;
  provider: string;
  asOf?: string;
  details?: Record<string, unknown>;
  notice: string;
};
export class FinanceError extends Error {
  constructor(public status: number, public code: string) { super(code); this.name = "FinanceError"; }
}

const NOTICE = "Informational only: may be delayed, not licensed for trading, not investment advice.";
const TIMEOUT_MS = 8000;
const SYMBOL = /^[A-Z0-9][A-Z0-9._\/=-]{0,19}$/;

async function getJson(url: string, headers: Record<string, string> = {}): Promise<any | null> {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json", ...headers }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const text = await res.text();
    if (text.length > 500_000) return null;
    return JSON.parse(text);
  } catch { return null; }
}
const num = (x: unknown): number | null => { const n = Number(x); return Number.isFinite(n) && n > 0 ? n : null; };
const quote = (q: Omit<MarketQuote, "notice">): MarketQuote => ({ ...q, notice: NOTICE });
const enc = encodeURIComponent;

export async function fetchMultiAssetQuote(rawSymbol: string, assetClass: AssetClass): Promise<MarketQuote> {
  const symbol = rawSymbol.trim().toUpperCase();
  if (!SYMBOL.test(symbol)) throw new FinanceError(400, "INVALID_SYMBOL");
  // The privacy gate: no market API call leaves the server in ollama-only mode.
  if (ollamaOnly()) throw new FinanceError(503, "EXTERNAL_DATA_DISABLED");
  switch (assetClass) {
    case "crypto": return crypto(symbol);
    case "forex": return forex(symbol);
    case "commodities": return commodity(symbol);
    case "options": return options(symbol);
    case "futures": throw new FinanceError(501, "FUTURES_NOT_CONFIGURED");   // no verified free futures feed; add a licensed adapter
    case "stocks_etfs": return stock(symbol);
  }
}

const pct = (n: unknown) => { const v = Number(n); return Number.isFinite(v) ? `${v.toFixed(2)}%` : undefined; };

/** Finnhub: US stocks and ETFs. Free tier, 60 calls a minute. `c` is the price and `dp` the percent change; c = 0 means an unknown symbol. */
async function finnhub(symbol: string, key: string): Promise<MarketQuote | null> {
  const d = await getJson(`https://finnhub.io/api/v1/quote?symbol=${enc(symbol)}`, { "X-Finnhub-Token": key });
  const price = num(d?.c);
  if (!price) return null;
  return quote({ symbol, assetClass: "stocks_etfs", price, currency: "USD", changePercent: pct(d.dp), provider: "finnhub", asOf: Number.isFinite(Number(d.t)) && Number(d.t) > 0 ? new Date(Number(d.t) * 1000).toISOString() : undefined });
}

/** Twelve Data: stocks, forex and spot metals (for example EUR/USD, XAU/USD). Free tier, 8 calls a minute. */
async function twelveData(symbol: string, key: string, assetClass: AssetClass, display = symbol): Promise<MarketQuote | null> {
  const d = await getJson(`https://api.twelvedata.com/quote?symbol=${enc(symbol)}`, { Authorization: `apikey ${key}` });
  if (!d || d.status === "error") return null;
  const price = num(d.close);
  if (!price) return null;
  return quote({ symbol: display, assetClass, price, currency: "USD", changePercent: pct(d.percent_change), provider: "twelvedata", asOf: typeof d.datetime === "string" ? d.datetime : undefined });
}

/**
 * Yahoo Finance (unofficial public chart endpoint, no key). Gives the latest regular-market price and the previous close, so
 * we can show a 24H change. Unlicensed and unofficial: informational only, labelled delayed, and it can change or block
 * without notice, so it falls through to the keyed providers. Set YAHOO_FINANCE_DISABLED=1 to turn it off.
 */
async function yahoo(symbol: string): Promise<MarketQuote | null> {
  if (process.env.YAHOO_FINANCE_DISABLED === "1") return null;
  const d = await getJson(`https://query1.finance.yahoo.com/v8/finance/chart/${enc(symbol)}?range=1d&interval=1m`, { "User-Agent": "Mozilla/5.0" });
  const m = d?.chart?.result?.[0]?.meta;
  const price = num(m?.regularMarketPrice);
  if (!price || (m?.currency && m.currency !== "USD")) return null;
  const prev = num(m.chartPreviousClose ?? m.previousClose);
  const t = Number(m.regularMarketTime);
  return quote({ symbol, assetClass: "stocks_etfs", price, currency: "USD", changePercent: prev ? pct(((price - prev) / prev) * 100) : undefined, provider: "yahoo", asOf: t > 0 ? new Date(t * 1000).toISOString() : undefined });
}

async function stock(symbol: string): Promise<MarketQuote> {
  const { ALPACA_API_KEY: key, ALPACA_API_SECRET: secret, ALPHAVANTAGE_API_KEY: av, API_NINJAS_KEY: ninja, FINNHUB_API_KEY: fh, TWELVEDATA_API_KEY: td } = process.env;
  { const q = await yahoo(symbol); if (q) return q; }
  if (key && secret) {
    const d = await getJson(`https://data.alpaca.markets/v2/stocks/${enc(symbol)}/trades/latest`, { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret });
    const price = num(d?.trade?.p);
    if (price) return quote({ symbol, assetClass: "stocks_etfs", price, currency: "USD", provider: "alpaca", asOf: d.trade.t });
  }
  if (fh) { const q = await finnhub(symbol, fh); if (q) return q; }
  if (av) {
    const d = await getJson(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${enc(symbol)}&apikey=${enc(av)}`);
    const q = d?.["Global Quote"]; const price = num(q?.["05. price"]);
    if (price) return quote({ symbol, assetClass: "stocks_etfs", price, currency: "USD", changePercent: q["10. change percent"], provider: "alphavantage", asOf: q["07. latest trading day"] });
  }
  if (td) { const q = await twelveData(symbol, td, "stocks_etfs"); if (q) return q; }
  if (ninja) {
    const d = await getJson(`https://api.api-ninjas.com/v1/stockprice?ticker=${enc(symbol)}`, { "X-Api-Key": ninja });
    const price = num(d?.price);
    if (price) return quote({ symbol, assetClass: "stocks_etfs", price, currency: d.currency || "USD", provider: "api-ninjas", details: { exchange: d.exchange, name: d.name } });
  }
  throw new FinanceError(503, (key && secret) || av || ninja || fh || td ? "QUOTE_UNAVAILABLE" : "PROVIDER_NOT_CONFIGURED");
}

const COINS: Record<string, string> = { BTC: "bitcoin", ETH: "ethereum", SOL: "solana", XRP: "ripple", ADA: "cardano", DOGE: "dogecoin", LTC: "litecoin", DOT: "polkadot" };
async function crypto(symbol: string): Promise<MarketQuote> {
  const base = symbol.replace(/[-\/]USDT?$/, "");
  const id = COINS[base] ?? base.toLowerCase();
  const demo = process.env.COINGECKO_API_KEY;
  const d = await getJson(`https://api.coingecko.com/api/v3/simple/price?ids=${enc(id)}&vs_currencies=usd&include_24hr_change=true`, demo ? { "x-cg-demo-api-key": demo } : {});
  const e = d?.[id]; const price = num(e?.usd);
  if (!price) throw new FinanceError(503, "QUOTE_UNAVAILABLE");
  return quote({ symbol, assetClass: "crypto", price, currency: "USD", changePercent: typeof e.usd_24h_change === "number" ? `${e.usd_24h_change.toFixed(2)}%` : undefined, provider: "coingecko" });
}

async function forex(pair: string): Promise<MarketQuote> {
  const clean = pair.replace(/[\/-]/g, "");
  const base = clean.slice(0, 3), to = clean.slice(3, 6) || "USD";
  if (!/^[A-Z]{3}$/.test(base) || !/^[A-Z]{3}$/.test(to)) throw new FinanceError(400, "INVALID_SYMBOL");
  const d = await getJson(`https://api.frankfurter.dev/v1/latest?base=${base}&symbols=${to}`);   // ECB reference rates, published daily
  const price = num(d?.rates?.[to]);
  if (price) return quote({ symbol: `${base}/${to}`, assetClass: "forex", price, currency: to, provider: "frankfurter-ecb", asOf: d.date });
  const td = process.env.TWELVEDATA_API_KEY;
  if (td) { const q = await twelveData(`${base}/${to}`, td, "forex", `${base}/${to}`); if (q) return { ...q, currency: to }; }
  throw new FinanceError(503, "QUOTE_UNAVAILABLE");
}

const AV_COMMODITIES: Record<string, string> = { OIL: "WTI", WTI: "WTI", BRENT: "BRENT", NATURAL_GAS: "NATURAL_GAS", GAS: "NATURAL_GAS", COPPER: "COPPER", WHEAT: "WHEAT", CORN: "CORN" };
const METALS: Record<string, string> = { XAU: "gold", XAG: "silver", XPT: "platinum", XPD: "palladium", GOLD: "gold", SILVER: "silver" };
async function commodity(raw: string): Promise<MarketQuote> {
  const { API_NINJAS_KEY: ninja, ALPHAVANTAGE_API_KEY: av, TWELVEDATA_API_KEY: td } = process.env;
  const stem = raw.replace(/[-\/]USD$/, "");
  const name = METALS[stem] ? METALS[stem].toUpperCase() : stem;
  if (ninja) {
    const d = await getJson(`https://api.api-ninjas.com/v1/commodityprice?name=${enc((METALS[stem] ?? name).toLowerCase())}`, { "X-Api-Key": ninja });
    const price = num(d?.price);
    if (price) return quote({ symbol: raw, assetClass: "commodities", price, currency: "USD", provider: "api-ninjas", details: { exchange: d.exchange, name: d.name } });
  }
  const metal = ["XAU", "XAG", "XPT", "XPD"].find(m => m === stem || (METALS[stem] && METALS[m] === METALS[stem]));
  if (td && metal) { const q = await twelveData(`${metal}/USD`, td, "commodities", raw); if (q) return q; }
  const fn = AV_COMMODITIES[name];
  if (av && fn) {
    const d = await getJson(`https://www.alphavantage.co/query?function=${fn}&interval=daily&apikey=${enc(av)}`);
    const latest = Array.isArray(d?.data) ? d.data[0] : null; const price = num(latest?.value);
    if (price) return quote({ symbol: fn, assetClass: "commodities", price, currency: "USD", provider: "alphavantage", asOf: latest.date, details: { unit: d.unit } });
  }
  throw new FinanceError(503, ninja || av || td ? "QUOTE_UNAVAILABLE" : "PROVIDER_NOT_CONFIGURED");
}

async function options(underlying: string): Promise<MarketQuote> {
  const token = process.env.TRADIER_ACCESS_TOKEN;
  if (!token) throw new FinanceError(503, "PROVIDER_NOT_CONFIGURED");
  const host = process.env.TRADIER_ENV === "sandbox" ? "sandbox.tradier.com" : "api.tradier.com";
  const d = await getJson(`https://${host}/v1/markets/options/expirations?symbol=${enc(underlying)}`, { Authorization: `Bearer ${token}` });
  const dates = d?.expirations?.date;
  const list: string[] = Array.isArray(dates) ? dates : typeof dates === "string" ? [dates] : [];
  if (!list.length) throw new FinanceError(503, "QUOTE_UNAVAILABLE");
  return quote({ symbol: underlying, assetClass: "options", price: null, currency: "USD", provider: "tradier", details: { nearestExpiration: list[0], expirations: list.length } });
}
