import "server-only";
import { fetchMultiAssetQuote, FinanceError, type AssetClass, type MarketQuote } from "./provider";

export type BatchItem = { symbol: string; assetClass: AssetClass };
export type BatchResult = { symbol: string; assetClass: AssetClass; quote?: MarketQuote; error?: string };

// A short shared cache keeps a watchlist refresh from hammering the free public APIs (and their rate limits).
const OK_TTL_MS = 60_000;
const FAIL_TTL_MS = 30_000;
const MAX_ITEMS = 25;
const CONCURRENCY = 4;
const cache = new Map<string, { at: number; result: BatchResult }>();

export const clearQuoteCache = () => cache.clear();

async function one(item: BatchItem): Promise<BatchResult> {
  const key = `${item.assetClass}:${item.symbol.trim().toUpperCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < (hit.result.quote ? OK_TTL_MS : FAIL_TTL_MS)) return hit.result;
  let result: BatchResult;
  try {
    result = { ...item, quote: await fetchMultiAssetQuote(item.symbol, item.assetClass) };
  } catch (e) {
    result = { ...item, error: e instanceof FinanceError ? e.code : "QUOTE_UNAVAILABLE" };
  }
  if (cache.size > 500) cache.clear();
  cache.set(key, { at: Date.now(), result });
  return result;
}

/** Quotes for up to 25 symbols. One bad symbol never fails the rest; duplicates are fetched once. */
export async function fetchQuoteBatch(items: BatchItem[]): Promise<BatchResult[]> {
  const unique = [...new Map(items.slice(0, MAX_ITEMS).map(i => [`${i.assetClass}:${i.symbol.trim().toUpperCase()}`, i])).values()];
  const out: BatchResult[] = new Array(unique.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, unique.length) }, async () => {
    while (next < unique.length) { const i = next++; out[i] = await one(unique[i]); }
  }));
  return out;
}
