import "server-only";
import { ollamaOnly } from "@/lib/pipeline/privacy";

/**
 * Extra informational price sources: public crypto tickers (Binance, Bybit, OKX) and OANDA's read-only pricing for forex and metals.
 * Prices only. Nothing here places an order, reads a balance or touches an account: the exchange calls are unauthenticated public
 * endpoints, and OANDA is called with GET /v3/accounts (to find the account id) and GET .../pricing, never anything else.
 * EXCHANGE_PRICES_DISABLED=1 turns the whole file off. Keys are never logged or returned.
 */
const TIMEOUT_MS = 6000;
const off = () => process.env.EXCHANGE_PRICES_DISABLED === "1" || ollamaOnly(); // private (ollama-only) mode makes no external calls

/** Reads an env var by any of these names, ignoring case (the keys in .env.local are spelled like OANDA_practice_API_KEY). */
export function envAny(...names: string[]): string {
  const wanted = names.map(n => n.toLowerCase());
  for (const [k, v] of Object.entries(process.env)) if (v && wanted.includes(k.toLowerCase())) return v.trim();
  return "";
}
export const oandaToken = () => envAny("OANDA_API_KEY");
export const oandaPracticeToken = () => envAny("OANDA_PRACTICE_API_KEY");
export const oandaConfigured = () => !off() && !!(oandaToken() || oandaPracticeToken());

type Priced = { price: number; changePercent?: string; provider: string; asOf?: string };

async function get(url: string, headers: Record<string, string> = {}): Promise<any | null> {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json", ...headers }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const text = await res.text();
    return text.length > 500_000 ? null : JSON.parse(text);
  } catch { return null; }
}
const pos = (x: unknown): number | null => { const n = Number(x); return Number.isFinite(n) && n > 0 ? n : null; };
const pct = (n: number) => `${n.toFixed(2)}%`;

/** Public spot tickers, tried in order. Each is skipped quietly if it is unreachable or blocked in this region. */
export async function exchangeCrypto(base: string): Promise<Priced | null> {
  if (off() || !/^[A-Z0-9]{2,10}$/.test(base)) return null;
  const binance = await get(`https://api.binance.com/api/v3/ticker/24hr?symbol=${base}USDT`);
  let p = pos(binance?.lastPrice);
  if (p) return { price: p, changePercent: Number.isFinite(Number(binance.priceChangePercent)) ? pct(Number(binance.priceChangePercent)) : undefined, provider: "binance" };
  const bybit = (await get(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${base}USDT`))?.result?.list?.[0];
  p = pos(bybit?.lastPrice);
  if (p) return { price: p, changePercent: Number.isFinite(Number(bybit.price24hPcnt)) ? pct(Number(bybit.price24hPcnt) * 100) : undefined, provider: "bybit" };
  const okx = (await get(`https://www.okx.com/api/v5/market/ticker?instId=${base}-USDT`))?.data?.[0];
  p = pos(okx?.last);
  const open = pos(okx?.open24h);
  if (p) return { price: p, changePercent: open ? pct(((p - open) / open) * 100) : undefined, provider: "okx" };
  return null;
}

let accountId: { token: string; host: string; id: string } | null = null;

/** OANDA mid price for an instrument such as EUR_USD or XAU_USD. A practice token uses the practice host. Read-only. */
export async function oandaPrice(instrument: string): Promise<Priced | null> {
  if (off() || !/^[A-Z]{3,5}_[A-Z]{3}$/.test(instrument)) return null;
  for (const [token, host] of [[oandaToken(), "api-fxtrade.oanda.com"], [oandaPracticeToken(), "api-fxpractice.oanda.com"]] as const) {
    if (!token) continue;
    const auth = { Authorization: `Bearer ${token}` };
    if (!accountId || accountId.token !== token) {
      const id = (await get(`https://${host}/v3/accounts`, auth))?.accounts?.[0]?.id;
      if (typeof id !== "string" || !/^[0-9-]{3,40}$/.test(id)) continue;
      accountId = { token, host, id };
    }
    const d = await get(`https://${host}/v3/accounts/${accountId.id}/pricing?instruments=${instrument}`, auth);
    const row = d?.prices?.[0];
    const bid = pos(row?.bids?.[0]?.price ?? row?.closeoutBid), ask = pos(row?.asks?.[0]?.price ?? row?.closeoutAsk);
    if (bid && ask) return { price: (bid + ask) / 2, provider: host.includes("practice") ? "oanda-practice" : "oanda", asOf: typeof row.time === "string" ? row.time : undefined };
    accountId = null;                                  // forget a stale account id and try the next token
  }
  return null;
}
