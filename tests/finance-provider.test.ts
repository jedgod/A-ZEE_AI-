import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { fetchMultiAssetQuote, FinanceError } from "@/lib/finance/provider";
import { clearQuoteCache, fetchQuoteBatch } from "@/lib/finance/batch";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const KEYS = ["AZ_PROVIDER_MODE", "ALPACA_API_KEY", "ALPACA_API_SECRET", "ALPHAVANTAGE_API_KEY", "API_NINJAS_KEY", "TRADIER_ACCESS_TOKEN", "COINGECKO_API_KEY", "FINNHUB_API_KEY", "TWELVEDATA_API_KEY"];
const fetchMock = vi.fn();

beforeEach(() => { for (const k of KEYS) delete process.env[k]; process.env.YAHOO_FINANCE_DISABLED = "1"; clearQuoteCache(); fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());

const chart = (meta: object) => ok({ chart: { result: [{ meta }] } });
const code = async (p: Promise<unknown>) => p.then(() => "none", (e: FinanceError) => `${e.status}:${e.code}`);

describe("Yahoo stock quotes", () => {
  it("prices a stock with its change from the previous close, labelled yahoo, and needs no key", async () => {
    delete process.env.YAHOO_FINANCE_DISABLED;
    fetchMock.mockResolvedValueOnce(chart({ regularMarketPrice: 110, chartPreviousClose: 100, currency: "USD", regularMarketTime: 1_700_000_000 }));
    const q = await fetchMultiAssetQuote("AAPL", "stocks_etfs");
    expect(q).toMatchObject({ price: 110, provider: "yahoo", changePercent: "10.00%" });
    expect(String(fetchMock.mock.calls[0][0])).toContain("finance/chart/AAPL");
  });
  it("falls through to the keyed providers when Yahoo has nothing", async () => {
    delete process.env.YAHOO_FINANCE_DISABLED; process.env.FINNHUB_API_KEY = "k";
    fetchMock.mockResolvedValueOnce(new Response("", { status: 429 })).mockResolvedValueOnce(ok({ c: 5, dp: 1 }));
    expect((await fetchMultiAssetQuote("AAPL", "stocks_etfs")).provider).toBe("finnhub");
  });
});

describe("Try Finance multi-asset quotes", () => {
  it("makes no outbound call in ollama-only mode", async () => {
    process.env.AZ_PROVIDER_MODE = "ollama-only";
    expect(await code(fetchMultiAssetQuote("AAPL", "stocks_etfs"))).toBe("503:EXTERNAL_DATA_DISABLED");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects symbols that could change the request before any call", async () => {
    for (const s of ["", "AAPL&apikey=x", "../x", "A B", "A".repeat(30)]) expect(await code(fetchMultiAssetQuote(s, "stocks_etfs"))).toBe("400:INVALID_SYMBOL");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("says so when no provider is configured, instead of inventing a price", async () => {
    expect(await code(fetchMultiAssetQuote("AAPL", "stocks_etfs"))).toBe("503:PROVIDER_NOT_CONFIGURED");
    expect(await code(fetchMultiAssetQuote("GOLD", "commodities"))).toBe("503:PROVIDER_NOT_CONFIGURED");
    expect(await code(fetchMultiAssetQuote("SPY", "options"))).toBe("503:PROVIDER_NOT_CONFIGURED");
  });
  it("falls through to the next stock provider and labels the source", async () => {
    process.env.ALPACA_API_KEY = "k"; process.env.ALPACA_API_SECRET = "s"; process.env.ALPHAVANTAGE_API_KEY = "av";
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 403 })).mockResolvedValueOnce(ok({ "Global Quote": { "05. price": "190.5", "10. change percent": "1.2%" } }));
    const q = await fetchMultiAssetQuote("aapl", "stocks_etfs");
    expect(q).toMatchObject({ symbol: "AAPL", price: 190.5, provider: "alphavantage" });
    expect(q.notice).toMatch(/not investment advice/);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://data.alpaca.markets/v2/stocks/AAPL/trades/latest");
  });
  it("quotes crypto and forex without any key, and never returns a zero price", async () => {
    fetchMock.mockResolvedValueOnce(ok({ bitcoin: { usd: 65000, usd_24h_change: 1.234 } }));
    expect(await fetchMultiAssetQuote("BTC", "crypto")).toMatchObject({ price: 65000, changePercent: "1.23%", provider: "coingecko" });
    fetchMock.mockResolvedValueOnce(ok({ date: "2026-11-11", rates: { USD: 1.08 } }));
    expect(await fetchMultiAssetQuote("EUR/USD", "forex")).toMatchObject({ symbol: "EUR/USD", price: 1.08, provider: "frankfurter-ecb" });
    fetchMock.mockResolvedValueOnce(ok({ bitcoin: { usd: 0 } }));
    expect(await code(fetchMultiAssetQuote("BTC", "crypto"))).toBe("503:QUOTE_UNAVAILABLE");
  });
  it("does not pretend to have a futures feed", async () => {
    expect(await code(fetchMultiAssetQuote("ES", "futures"))).toBe("501:FUTURES_NOT_CONFIGURED");
  });
  it("treats a failing or malformed upstream as unavailable", async () => {
    fetchMock.mockRejectedValueOnce(new Error("boom"));
    expect(await code(fetchMultiAssetQuote("ETH", "crypto"))).toBe("503:QUOTE_UNAVAILABLE");
    fetchMock.mockResolvedValueOnce(new Response("<html>", { status: 200 }));
    expect(await code(fetchMultiAssetQuote("ETH", "crypto"))).toBe("503:QUOTE_UNAVAILABLE");
  });
  it("resolves watchlist-style names: BTC-USD is the coin, EUR/USD the pair", async () => {
    fetchMock.mockResolvedValueOnce(ok({ bitcoin: { usd: 65000 } }));
    expect(await fetchMultiAssetQuote("BTC-USD", "crypto")).toMatchObject({ price: 65000 });
    expect(String(fetchMock.mock.calls[0][0])).toContain("ids=bitcoin&");
  });
  it("batch: one bad symbol does not fail the rest, duplicates are fetched once, results are cached", async () => {
    fetchMock.mockImplementation(async (url: string) => String(url).includes("bitcoin") ? ok({ bitcoin: { usd: 65000, usd_24h_change: -1.5 } }) : new Response("nope", { status: 500 }));
    const items = [{ symbol: "BTC", assetClass: "crypto" as const }, { symbol: "btc", assetClass: "crypto" as const }, { symbol: "ZZZZ", assetClass: "futures" as const }, { symbol: "NOPE", assetClass: "crypto" as const }];
    const first = await fetchQuoteBatch(items);
    expect(first).toHaveLength(3);
    expect(first[0].quote).toMatchObject({ price: 65000, changePercent: "-1.50%" });
    expect(first[1].error).toBe("FUTURES_NOT_CONFIGURED");
    expect(first[2].error).toBe("QUOTE_UNAVAILABLE");
    const calls = fetchMock.mock.calls.length;
    await fetchQuoteBatch(items);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });
  it("batch: no outbound call in ollama-only mode, and at most 25 symbols are looked at", async () => {
    process.env.AZ_PROVIDER_MODE = "ollama-only";
    const many = Array.from({ length: 40 }, (_, i) => ({ symbol: `S${i}`, assetClass: "stocks_etfs" as const }));
    const r = await fetchQuoteBatch(many);
    expect(r).toHaveLength(25);
    expect(r.every(x => x.error === "EXTERNAL_DATA_DISABLED")).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("Finnhub: quotes a stock with its percent change, sends the key in a header (not the URL), and treats price 0 as unknown", async () => {
    process.env.FINNHUB_API_KEY = "fh-secret";
    fetchMock.mockResolvedValueOnce(ok({ c: 178.72, dp: 0.76, t: 1762984800 }));
    const q = await fetchMultiAssetQuote("AAPL", "stocks_etfs");
    expect(q).toMatchObject({ price: 178.72, changePercent: "0.76%", provider: "finnhub" });
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://finnhub.io/api/v1/quote?symbol=AAPL");
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("fh-secret");
    expect(fetchMock.mock.calls[0][1].headers["X-Finnhub-Token"]).toBe("fh-secret");
    fetchMock.mockResolvedValueOnce(ok({ c: 0, dp: null }));
    expect(await code(fetchMultiAssetQuote("NOPE", "stocks_etfs"))).toBe("503:QUOTE_UNAVAILABLE");
  });
  it("falls through the stock providers in order, and a missing key never blocks another provider", async () => {
    process.env.FINNHUB_API_KEY = "fh"; process.env.TWELVEDATA_API_KEY = "td";
    fetchMock.mockResolvedValueOnce(new Response("limit", { status: 429 }))   // finnhub rate-limited
      .mockResolvedValueOnce(ok({ symbol: "AAPL", close: "190.10", percent_change: "-0.40", datetime: "2026-11-12" }));
    expect(await fetchMultiAssetQuote("AAPL", "stocks_etfs")).toMatchObject({ price: 190.1, changePercent: "-0.40%", provider: "twelvedata" });
  });
  it("Twelve Data: spot gold, and forex when the ECB source is down", async () => {
    process.env.TWELVEDATA_API_KEY = "td";
    fetchMock.mockResolvedValueOnce(ok({ symbol: "XAU/USD", close: "2331.40", percent_change: "0.54", datetime: "2026-11-12 10:00:00" }));
    expect(await fetchMultiAssetQuote("XAU-USD", "commodities")).toMatchObject({ symbol: "XAU-USD", price: 2331.4, provider: "twelvedata" });
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.twelvedata.com/quote?symbol=XAU%2FUSD");
    fetchMock.mockResolvedValueOnce(new Response("down", { status: 503 })).mockResolvedValueOnce(ok({ close: "1.1081", percent_change: "0.1", datetime: "2026-11-12" }));
    expect(await fetchMultiAssetQuote("EUR/USD", "forex")).toMatchObject({ price: 1.1081, provider: "twelvedata", currency: "USD" });
    fetchMock.mockResolvedValueOnce(ok({ status: "error", code: 401, message: "bad key" }));
    expect(await code(fetchMultiAssetQuote("XAG-USD", "commodities"))).toBe("503:QUOTE_UNAVAILABLE");
  });
  it("still says PROVIDER_NOT_CONFIGURED when none of the new keys exist", async () => {
    expect(await code(fetchMultiAssetQuote("XAU-USD", "commodities"))).toBe("503:PROVIDER_NOT_CONFIGURED");
    expect(await code(fetchMultiAssetQuote("AAPL", "stocks_etfs"))).toBe("503:PROVIDER_NOT_CONFIGURED");
  });
});
