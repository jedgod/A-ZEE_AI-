import "server-only";
import { CATALOG, availability, type CatalogEntry } from "@/lib/finance/catalog";
import { fetchQuoteBatch } from "@/lib/finance/batch";

/**
 * Delayed, informational quotes for the assets a research question names. They come from the same free public
 * sources as the Markets screen (CoinGecko, Frankfurter, and any keyed provider the server has) and are labelled
 * "delayed" end to end: never a licensed feed, never used to place or price a trade.
 */
export type DelayedQuote = { symbol: string; price: string; source: string; observed_at: string };

const MAX_ASSETS = 5;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** Catalog assets the question mentions by ticker ("BTC", "EUR/USD") or by first name ("bitcoin", "tesla"). */
export function mentionedAssets(message: string): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  for (const e of CATALOG) {
    const base = e.symbol.replace(/-USD$/, "");                          // the catalog says "BTC-USD"; people write "BTC"
    const short = base.length <= 2;                                      // "V" would match any capital V: require exact case
    const bySymbol = new RegExp(`(?<![A-Za-z0-9])${escape(base)}(?:-USD)?(?![A-Za-z0-9])`, short ? "" : "i").test(message);
    const first = e.name.split(/[\s/(]/)[0].replace(/[^A-Za-z]/g, "");
    const byName = first.length >= 4 && new RegExp(`\\b${escape(first)}\\b`, "i").test(message);
    if (bySymbol || byName) out.push(e);
    if (out.length >= MAX_ASSETS) break;
  }
  return out;
}

const decimal = (n: number) => (Number.isFinite(n) && n >= 0 && n < 1e12 ? n.toFixed(8).replace(/0+$/, "").replace(/\.$/, "") : null);

export async function delayedQuotesFor(message: string): Promise<DelayedQuote[]> {
  const assets = mentionedAssets(message).filter(e => availability(e).live);
  if (!assets.length) return [];
  const results = await fetchQuoteBatch(assets.map(e => ({ symbol: e.symbol, assetClass: e.assetClass })));
  const quotes: DelayedQuote[] = [];
  for (const r of results) {
    const price = r.quote?.price == null ? null : decimal(r.quote.price);
    if (!price || !r.quote) continue;
    quotes.push({
      symbol: r.symbol.slice(0, 32).toUpperCase(), price,
      source: `${r.quote.provider} (delayed)`.slice(0, 64), observed_at: (r.quote.asOf ?? new Date().toISOString()).slice(0, 40),
    });
  }
  return quotes;
}
