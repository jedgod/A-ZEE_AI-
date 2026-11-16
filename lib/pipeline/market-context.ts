import "server-only";
import { CATALOG, type CatalogEntry } from "@/lib/finance/catalog";
import { fetchQuoteBatch } from "@/lib/finance/batch";
import { ollamaOnly } from "./privacy";
import type { RetrievedSource } from "./context";

/**
 * Live market numbers for questions like "what is the rate for the trading market today", "price of bitcoin", "how is Tesla doing", "EUR/USD".
 * Without it the model says it has no market data. Quotes come from the same informational, delayed sources as the trading page
 * (lib/finance/provider.ts) and are passed to the model as untrusted data to quote, never as instructions or advice.
 * MARKET_CONTEXT_DISABLED=1 turns it off. Nothing leaves the server in ollama-only mode.
 */
const MAX_QUOTES = 8;

// With no asset named, it must be about markets in general AND ask for the current state of them.
const MARKET = /\b(markets?|trading|stocks?|crypto|forex|exchange rates?|indices|indexes|s&p|nasdaq|dow)\b/i;
const CUE = /\b(today|now|current(?:ly)?|latest|live|day|tonight|right now|doing|how'?s|how is|how are|open|closed)\b/i;
const QUESTION = /\b(what|how|show|tell|give|say|check|price|rate|quote|worth|doing)\b|\?/i;

/** Names people actually type, mapped to catalog symbols (the catalog's own names are matched too). */
const ALIASES: Record<string, string> = {
  bitcoin: "BTC-USD", btc: "BTC-USD", ethereum: "ETH-USD", ether: "ETH-USD", solana: "SOL-USD", ripple: "XRP-USD", dogecoin: "DOGE-USD",
  gold: "XAU-USD", silver: "XAG-USD", platinum: "XPT-USD", "crude oil": "WTI", oil: "WTI", "natural gas": "NATURAL_GAS",
  "s&p": "SPY", "s&p 500": "SPY", sp500: "SPY", nasdaq: "QQQ", "russell 2000": "IWM", euro: "EUR/USD", pound: "GBP/USD", sterling: "GBP/USD", yen: "USD/JPY", cedi: "USD/GHS",
  google: "GOOGL", alphabet: "GOOGL", facebook: "META", apple: "AAPL", microsoft: "MSFT", tesla: "TSLA", nvidia: "NVDA", amazon: "AMZN", netflix: "NFLX",
};
/** What "the market today" means when no symbol is named: US large caps and tech, the big two coins, gold and the main currency pairs. */
const OVERVIEW = ["SPY", "QQQ", "BTC-USD", "ETH-USD", "XAU-USD", "EUR/USD", "GBP/USD", "USD/JPY"];

const bySymbol = (sym: string) => CATALOG.find(e => e.symbol.toUpperCase() === sym.toUpperCase());

/** Which catalog entries the question names. Empty when it names none. Exported for tests. */
export function namedAssets(text: string): CatalogEntry[] {
  const lower = ` ${text.toLowerCase().replace(/[^a-z0-9&/ .-]/g, " ")} `;
  const found = new Map<string, CatalogEntry>();
  for (const [alias, sym] of Object.entries(ALIASES)) {
    if (new RegExp(`(^|[^a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(lower)) { const e = bySymbol(sym); if (e) found.set(e.symbol, e); }
  }
  for (const e of CATALOG) {
    const base = e.symbol.toLowerCase().split(/[-/]/)[0];
    // A ticker counts when written as a word; one- and two-letter tickers only when typed in capitals (so "V" or "a" aren't taken as Visa).
    const re = new RegExp(`(^|[^A-Za-z0-9])${e.symbol.replace(/[-/]/g, "[-/ ]?")}([^A-Za-z0-9]|$)`, "i");
    const caps = new RegExp(`(^|[^A-Za-z0-9])${base.toUpperCase()}([^A-Za-z0-9]|$)`);
    if (base.length >= 3 ? re.test(text) || caps.test(text) : caps.test(text)) found.set(e.symbol, e);
  }
  return [...found.values()].slice(0, MAX_QUOTES);
}

/** True when the message is asking for current market numbers. Exported for tests. */
export function wantsMarketData(text: string): boolean {
  const t = text.trim();
  if (t.length < 6 || t.length > 400) return false;
  return namedAssets(t).length > 0 ? QUESTION.test(t) && /\b(price|rate|quote|worth|trading|trade|doing|today|now|current|currently|live|latest|how much|up|down|market)\b|\?/i.test(t) : MARKET.test(t) && QUESTION.test(t) && CUE.test(t);
}

const fmt = (n: number) => (n >= 100 ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : n.toPrecision(5).replace(/\.?0+$/, ""));

export async function marketSources(question: string): Promise<{ sources: RetrievedSource[]; note?: string }> {
  if (ollamaOnly() || process.env.MARKET_CONTEXT_DISABLED === "1" || !wantsMarketData(question)) return { sources: [] };
  const named = namedAssets(question);
  const picked = named.length ? named : OVERVIEW.map(bySymbol).filter((e): e is CatalogEntry => !!e);
  const results = await fetchQuoteBatch(picked.map(e => ({ symbol: e.symbol, assetClass: e.assetClass }))).catch(() => []);
  const lines: string[] = [];
  for (const r of results) {
    const name = CATALOG.find(e => e.symbol === r.symbol)?.name ?? r.symbol;
    if (r.quote?.price != null) lines.push(`${r.symbol} (${name}): ${fmt(r.quote.price)} ${r.quote.currency}${r.quote.changePercent ? `, ${r.quote.changePercent} change` : ""}, source ${r.quote.provider}${r.quote.asOf ? `, as of ${r.quote.asOf}` : ""}`);
    else lines.push(`${r.symbol} (${name}): no quote available right now`);
  }
  if (!lines.some(l => !l.includes("no quote available"))) return { sources: [], note: "Live market quotes weren't available just now, so the answer has no current numbers." };
  const kind = named.length ? "Quotes you asked about" : "Market overview (no specific asset was named)";
  return { sources: [{
    sourceId: "market:1", title: "Live market quotes (delayed, informational)", trust: "untrusted" as const,
    text: `${kind}, fetched ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC. Prices may be delayed; informational only, not investment advice.\n${lines.join("\n")}`,
  }] };
}
