import { api } from "./api";

export type AssetClass = "crypto" | "stocks_etfs" | "forex" | "commodities";
export type Asset = { symbol: string; assetClass: AssetClass; name?: string };
export type CatalogItem = { symbol: string; name: string; assetClass: AssetClass; pair: string; live: boolean; history: boolean };
export type Range = "1D" | "1W" | "1M" | "3M" | "1Y";
export const RANGES: Range[] = ["1D", "1W", "1M", "3M", "1Y"];
export type Point = { t: number; c: number; o?: number; h?: number; l?: number; v?: number };
export type History = {
  symbol: string; assetClass: AssetClass; range: Range; currency: string; points: Point[];
  hasOhlc: boolean; hasVolume: boolean; source: string; asOf: number | null; intervalMs: number | null; notice: string;
};
export type Sparkline = { symbol: string; assetClass: AssetClass; range: Range; points: number[]; changePct: number | null; error?: string };

let catalog: CatalogItem[] | null = null;
let inflight: Promise<CatalogItem[]> | null = null;
/** The assets the server's monitoring and chart feeds can name, fetched once per app run. */
export async function loadCatalog(): Promise<CatalogItem[]> {
  if (catalog) return catalog;
  inflight ??= api<{ results: CatalogItem[] }>("/api/finance/symbols").then(r => (catalog = r.results)).finally(() => { inflight = null; });
  return inflight;
}

export const QUICK_ASSETS: Asset[] = [
  { symbol: "BTC-USD", assetClass: "crypto" }, { symbol: "TSLA", assetClass: "stocks_etfs" }, { symbol: "AAPL", assetClass: "stocks_etfs" }, { symbol: "NVDA", assetClass: "stocks_etfs" },
];

/** A symbol typed by hand: guess its class from its shape (the server validates it again). */
export const guessClass = (symbol: string): AssetClass => (/^X(AU|AG|PT|PD)(-USD)?$/.test(symbol) ? "commodities" : /-USDT?$/.test(symbol) ? "crypto" : /^[A-Z]{3}\/[A-Z]{3}$/.test(symbol) ? "forex" : "stocks_etfs");
export const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9._/=-]{0,19}$/;

export const fetchHistory = (a: Asset, range: Range, candles: boolean, signal?: AbortSignal) =>
  api<History>("/api/finance/history", { method: "POST", body: { symbol: a.symbol, assetClass: a.assetClass, range, ...(candles ? { candles: true } : {}) }, signal });
export const fetchSparklines = (items: Asset[]) =>
  api<{ results: Sparkline[] }>("/api/finance/sparklines", { method: "POST", body: { items: items.map(i => ({ symbol: i.symbol, assetClass: i.assetClass })) } });

export const HISTORY_ERRORS: Record<string, string> = {
  RANGE_NOT_AVAILABLE: "This source has daily data only. Pick 1W or longer.",
  PROVIDER_NOT_CONFIGURED: "No history source is set up for this asset on the server yet.",
  QUOTE_UNAVAILABLE: "No history came back for this asset right now.",
  EXTERNAL_DATA_DISABLED: "Charts are off while the server is in private mode.",
  INVALID_SYMBOL: "That symbol isn't valid.", RATE_LIMITED: "Too many requests. Wait a moment.",
};
