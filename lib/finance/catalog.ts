import "server-only";

/**
 * The assets the monitoring and chart feeds can name. `live` says whether a price source for it is configured on THIS server right
 * now (crypto and forex work without keys; stocks, ETFs and metals need a data key), and `history` whether a chart can be drawn.
 * Anything not listed can still be typed in as a custom symbol; it simply may not have a source.
 */
export type CatalogClass = "crypto" | "stocks_etfs" | "forex" | "commodities";
export type CatalogEntry = { symbol: string; name: string; assetClass: CatalogClass };
export type CatalogResult = CatalogEntry & { pair: string; live: boolean; history: boolean };

const c = (symbol: string, name: string): CatalogEntry => ({ symbol: `${symbol}-USD`, name: `${name} / US Dollar`, assetClass: "crypto" });
const s = (symbol: string, name: string): CatalogEntry => ({ symbol, name, assetClass: "stocks_etfs" });
const f = (symbol: string, name: string): CatalogEntry => ({ symbol, name, assetClass: "forex" });
const m = (symbol: string, name: string): CatalogEntry => ({ symbol, name, assetClass: "commodities" });

export const CATALOG: CatalogEntry[] = [
  c("BTC", "Bitcoin"), c("ETH", "Ethereum"), c("SOL", "Solana"), c("XRP", "XRP"), c("ADA", "Cardano"), c("DOGE", "Dogecoin"), c("LTC", "Litecoin"), c("DOT", "Polkadot"),
  s("AAPL", "Apple Inc."), s("MSFT", "Microsoft Corporation"), s("NVDA", "NVIDIA Corporation"), s("TSLA", "Tesla, Inc."), s("AMZN", "Amazon.com, Inc."), s("GOOGL", "Alphabet Inc. (Class A)"),
  s("META", "Meta Platforms, Inc."), s("AMD", "Advanced Micro Devices, Inc."), s("NFLX", "Netflix, Inc."), s("JPM", "JPMorgan Chase & Co."), s("V", "Visa Inc."), s("DIS", "The Walt Disney Company"),
  s("SPY", "SPDR S&P 500 ETF Trust"), s("QQQ", "Invesco QQQ Trust (Nasdaq-100)"), s("VTI", "Vanguard Total Stock Market ETF"), s("GLD", "SPDR Gold Shares"), s("IWM", "iShares Russell 2000 ETF"),
  f("EUR/USD", "Euro / US Dollar"), f("GBP/USD", "British Pound / US Dollar"), f("USD/JPY", "US Dollar / Japanese Yen"), f("USD/CHF", "US Dollar / Swiss Franc"),
  f("AUD/USD", "Australian Dollar / US Dollar"), f("USD/CAD", "US Dollar / Canadian Dollar"), f("NZD/USD", "New Zealand Dollar / US Dollar"), f("USD/GHS", "US Dollar / Ghanaian Cedi"), f("EUR/GBP", "Euro / British Pound"),
  m("XAU-USD", "Gold / US Dollar"), m("XAG-USD", "Silver / US Dollar"), m("XPT-USD", "Platinum / US Dollar"), m("WTI", "WTI Crude Oil"), m("BRENT", "Brent Crude Oil"), m("NATURAL_GAS", "Natural Gas"), m("COPPER", "Copper"),
];

const env = (k: string) => !!process.env[k];
const stockSource = () => (env("ALPACA_API_KEY") && env("ALPACA_API_SECRET")) || env("FINNHUB_API_KEY") || env("ALPHAVANTAGE_API_KEY") || env("TWELVEDATA_API_KEY") || env("API_NINJAS_KEY");
const stockHistory = () => (env("ALPACA_API_KEY") && env("ALPACA_API_SECRET")) || env("TWELVEDATA_API_KEY");
const isMetal = (symbol: string) => /^X(AU|AG|PT|PD)(-USD)?$/.test(symbol);

export function availability(e: CatalogEntry): { live: boolean; history: boolean } {
  switch (e.assetClass) {
    case "crypto": return { live: true, history: true };
    case "forex": return { live: true, history: true };
    case "stocks_etfs": return { live: !!stockSource(), history: !!stockHistory() };
    case "commodities": return { live: env("API_NINJAS_KEY") || (env("TWELVEDATA_API_KEY") && isMetal(e.symbol)) || (env("ALPHAVANTAGE_API_KEY") && !isMetal(e.symbol)), history: env("TWELVEDATA_API_KEY") && isMetal(e.symbol) };
  }
}

const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Typing "BTC" finds "BTC-USD · Bitcoin / US Dollar"; "tesla" finds TSLA. Symbol matches rank first. */
export function searchCatalog(query: string, limit = 40): CatalogResult[] {
  const q = norm(query);
  const scored = CATALOG.map(e => {
    const sym = norm(e.symbol), name = norm(e.name);
    const score = !q ? 1 : sym === q ? 100 : sym.startsWith(q) ? 80 : name.startsWith(q) ? 60 : sym.includes(q) ? 40 : name.includes(q) ? 30 : 0;
    return { e, score };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ e }) => ({ ...e, pair: e.assetClass === "stocks_etfs" ? `${e.symbol} · ${e.name}` : `${e.symbol} · ${e.name}`, ...availability(e) }));
}
