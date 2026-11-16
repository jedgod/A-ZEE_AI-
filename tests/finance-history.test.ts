import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { clearHistoryCache, downsample, fetchHistory, fetchSparklines, type Point } from "@/lib/finance/history";
import { availability, searchCatalog } from "@/lib/finance/catalog";
import { FinanceError } from "@/lib/finance/provider";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const KEYS = ["AZ_PROVIDER_MODE", "ALPACA_API_KEY", "ALPACA_API_SECRET", "ALPHAVANTAGE_API_KEY", "API_NINJAS_KEY", "FINNHUB_API_KEY", "TWELVEDATA_API_KEY", "COINGECKO_API_KEY"];
const fetchMock = vi.fn();
beforeEach(() => { for (const k of KEYS) delete process.env[k]; process.env.YAHOO_FINANCE_DISABLED = "1"; process.env.EXCHANGE_PRICES_DISABLED = "1"; clearHistoryCache(); fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());
const code = async (p: Promise<unknown>) => p.then(() => "none", (e: FinanceError) => `${e.status}:${e.code}`);
const series = (n: number, step = 300_000, t0 = 1_794_000_000_000) => Array.from({ length: n }, (_, i): [number, number] => [t0 + i * step, 70_000 + i]);

describe("catalog", () => {
  it("typing BTC shows 'BTC-USD · Bitcoin / US Dollar'; a company name finds its ticker; matches rank by symbol first", () => {
    expect(searchCatalog("btc")[0]).toMatchObject({ symbol: "BTC-USD", pair: "BTC-USD · Bitcoin / US Dollar", assetClass: "crypto" });
    expect(searchCatalog("tesla")[0]).toMatchObject({ symbol: "TSLA", assetClass: "stocks_etfs" });
    expect(searchCatalog("eur/usd")[0].symbol).toBe("EUR/USD");
    expect(searchCatalog("gold")[0].symbol).toBe("XAU-USD");
    expect(searchCatalog("zzzzzz")).toEqual([]);
    expect(searchCatalog("").length).toBeGreaterThan(30);
  });
  it("says which assets have a source on this server: crypto and forex always, stocks and metals only with a key", () => {
    const by = (q: string) => searchCatalog(q)[0];
    expect(by("btc")).toMatchObject({ live: true, history: true });
    expect(by("eur/usd")).toMatchObject({ live: true, history: true });
    expect(by("tsla")).toMatchObject({ live: false, history: false });
    process.env.FINNHUB_API_KEY = "k";
    expect(by("tsla")).toMatchObject({ live: true, history: false });     // quotes yes, charts need Alpaca or Twelve Data
    process.env.TWELVEDATA_API_KEY = "k";
    expect(by("tsla")).toMatchObject({ live: true, history: true });
    expect(by("gold")).toMatchObject({ live: true, history: true });
    expect(availability({ symbol: "WTI", name: "WTI", assetClass: "commodities" })).toEqual({ live: false, history: false });
  });
});

describe("history", () => {
  it("downsample keeps the first and last point and the cap, and sums volume", () => {
    const pts: Point[] = Array.from({ length: 1000 }, (_, i) => ({ t: i, c: i, v: 1 }));
    const out = downsample(pts, 240);
    expect(out).toHaveLength(240);
    expect(out[0].t).toBe(0); expect(out[239].t).toBe(999);
    expect(out.slice(1, -1).reduce((n, p) => n + (p.v ?? 0), 0)).toBeGreaterThan(900);
    expect(downsample(pts.slice(0, 10), 240)).toHaveLength(10);
  });
  it("crypto: a price line with volume from CoinGecko, no key needed", async () => {
    fetchMock.mockResolvedValueOnce(ok({ prices: series(288), total_volumes: series(288).map(([t]) => [t, 5]) }));
    const h = await fetchHistory("btc-usd", "crypto", "1D");
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=1");
    expect(h).toMatchObject({ symbol: "BTC-USD", range: "1D", currency: "USD", hasOhlc: false, hasVolume: true, source: "coingecko (delayed)" });
    expect(h.points.length).toBeLessThanOrEqual(240);
    expect(h.intervalMs).toBeGreaterThan(0);
    expect(h.notice).toMatch(/Delayed/);
  });
  it("crypto: candles use the OHLC endpoint with a supported day count", async () => {
    fetchMock.mockResolvedValueOnce(ok(Array.from({ length: 60 }, (_, i) => [1_794_000_000_000 + i * 14_400_000, 100, 110, 90, 105])));
    const h = await fetchHistory("ETH-USD", "crypto", "1M", { candles: true });
    expect(String(fetchMock.mock.calls[0][0])).toContain("/coins/ethereum/ohlc?vs_currency=usd&days=30");
    expect(h.hasOhlc).toBe(true);
    expect(h.points[0]).toMatchObject({ o: 100, h: 110, l: 90, c: 105 });
  });
  it("forex: daily ECB rates; 1D is not available because there is no intraday data", async () => {
    expect(await code(fetchHistory("EUR/USD", "forex", "1D"))).toBe("422:RANGE_NOT_AVAILABLE");
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(ok({ rates: { "2026-11-09": { USD: 1.1 }, "2026-11-10": { USD: 1.11 }, "2026-11-12": { USD: 1.12 } } }));
    const h = await fetchHistory("EUR/USD", "forex", "1W");
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/^https:\/\/api\.frankfurter\.dev\/v1\/\d{4}-\d\d-\d\d\.\.\d{4}-\d\d-\d\d\?base=EUR&symbols=USD$/);
    expect(h.points.map(p => p.c)).toEqual([1.1, 1.11, 1.12]);   // the missing day stays a gap, nothing is invented
    expect(h).toMatchObject({ source: "frankfurter-ecb (delayed)", currency: "USD", hasOhlc: false });
  });
  it("stocks: Alpaca bars first, Twelve Data next, and a clear error without a key", async () => {
    expect(await code(fetchHistory("TSLA", "stocks_etfs", "1M"))).toBe("503:PROVIDER_NOT_CONFIGURED");
    process.env.ALPACA_API_KEY = "a"; process.env.ALPACA_API_SECRET = "s"; process.env.TWELVEDATA_API_KEY = "td"; clearHistoryCache();
    fetchMock.mockResolvedValueOnce(new Response("denied", { status: 403 }))
      .mockResolvedValueOnce(ok({ values: [{ datetime: "2026-11-12", open: "10", high: "12", low: "9", close: "11", volume: "1000" }, { datetime: "2026-11-11", open: "9", high: "11", low: "8", close: "10", volume: "900" }] }));
    const h = await fetchHistory("TSLA", "stocks_etfs", "1M");
    expect(String(fetchMock.mock.calls[0][0])).toContain("https://data.alpaca.markets/v2/stocks/TSLA/bars?timeframe=1Day");
    expect(fetchMock.mock.calls[0][1].headers["APCA-API-SECRET-KEY"]).toBe("s");
    expect(h).toMatchObject({ source: "twelvedata (delayed)", hasOhlc: true, hasVolume: true });
    expect(h.points.map(p => p.c)).toEqual([10, 11]);   // oldest first
  });
  it("metals need Twelve Data; oil and gas have no free history source", async () => {
    expect(await code(fetchHistory("XAU-USD", "commodities", "1M"))).toBe("503:PROVIDER_NOT_CONFIGURED");
    process.env.TWELVEDATA_API_KEY = "td"; clearHistoryCache();   // a failure is remembered briefly, so forget it after adding the key
    expect(await code(fetchHistory("WTI", "commodities", "1M"))).toBe("503:PROVIDER_NOT_CONFIGURED");
    fetchMock.mockResolvedValueOnce(ok({ values: [{ datetime: "2026-11-12", open: "2300", high: "2340", low: "2290", close: "2331" }, { datetime: "2026-11-11", open: "2290", high: "2310", low: "2280", close: "2300" }] }));
    expect((await fetchHistory("XAU-USD", "commodities", "1M")).symbol).toBe("XAU-USD");
    expect(String(fetchMock.mock.calls[0][0])).toContain("symbol=XAU%2FUSD");
  });
  it("rejects bad input before any call, honours private mode, and never returns a half-empty chart", async () => {
    expect(await code(fetchHistory("BTC&x=1", "crypto", "1D"))).toBe("400:INVALID_SYMBOL");
    expect(await code(fetchHistory("BTC-USD", "crypto", "5Y" as never))).toBe("400:INVALID_RANGE");
    process.env.AZ_PROVIDER_MODE = "ollama-only";
    expect(await code(fetchHistory("BTC-USD", "crypto", "1D"))).toBe("503:EXTERNAL_DATA_DISABLED");
    delete process.env.AZ_PROVIDER_MODE;
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(ok({ prices: [[1, 5]] }));
    expect(await code(fetchHistory("BTC-USD", "crypto", "1W"))).toBe("503:QUOTE_UNAVAILABLE");
  });
  it("caches successful history, per range", async () => {
    fetchMock.mockImplementation(async () => ok({ prices: series(50) }));
    await fetchHistory("BTC-USD", "crypto", "1D"); await fetchHistory("BTC-USD", "crypto", "1D");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await fetchHistory("BTC-USD", "crypto", "1W");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("sparklines: about 48 points per asset, a bad one does not fail the rest, forex uses a week", async () => {
    fetchMock.mockImplementation(async (url: string) => String(url).includes("coingecko") ? ok({ prices: series(288) }) : new Response("nope", { status: 500 }));
    const r = await fetchSparklines([{ symbol: "BTC-USD", assetClass: "crypto" }, { symbol: "btc-usd", assetClass: "crypto" }, { symbol: "EUR/USD", assetClass: "forex" }, { symbol: "TSLA", assetClass: "stocks_etfs" }]);
    expect(r).toHaveLength(3);
    expect(r[0].points.length).toBeLessThanOrEqual(48);
    expect(r[0].changePct).toBeGreaterThan(0);
    expect(r[1]).toMatchObject({ symbol: "EUR/USD", range: "1W", error: "QUOTE_UNAVAILABLE", points: [] });
    expect(r[2].error).toBe("PROVIDER_NOT_CONFIGURED");
  });
});
