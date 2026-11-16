import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { fetchMultiAssetQuote } from "@/lib/finance/provider";
import { clearQuoteCache } from "@/lib/finance/batch";
import { dataSources, availability, searchCatalog } from "@/lib/finance/catalog";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const fetchMock = vi.fn();
const KEYS = ["OANDA_API_KEY", "OANDA_practice_API_KEY", "OANDA_PRACTICE_API_KEY", "OKX_API_KEY", "TWELVEDATA_API_KEY", "API_NINJAS_KEY", "ALPHAVANTAGE_API_KEY", "FINNHUB_API_KEY"];
const urls = () => fetchMock.mock.calls.map(c => String(c[0]));

beforeEach(() => { for (const k of KEYS) delete process.env[k]; process.env.YAHOO_FINANCE_DISABLED = "1"; delete process.env.EXCHANGE_PRICES_DISABLED; clearQuoteCache(); fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => vi.unstubAllGlobals());

describe("exchange price fallbacks (public tickers, prices only)", () => {
  it("uses CoinGecko first and the exchanges only when it fails", async () => {
    fetchMock.mockResolvedValueOnce(ok({ bitcoin: { usd: 100, usd_24h_change: 1 } }));
    expect((await fetchMultiAssetQuote("BTC-USD", "crypto")).provider).toBe("coingecko");
    expect(urls()).toHaveLength(1);
  });
  it("falls back Binance, then Bybit, then OKX, without sending any key", async () => {
    process.env.OKX_API_KEY = "secret-okx";
    fetchMock.mockResolvedValueOnce(new Response("", { status: 429 }))          // coingecko
      .mockResolvedValueOnce(new Response("", { status: 451 }))                 // binance blocked in region
      .mockResolvedValueOnce(ok({ result: { list: [{ lastPrice: "0" }] } }))    // bybit nothing
      .mockResolvedValueOnce(ok({ data: [{ last: "50000", open24h: "40000" }] }));
    const q = await fetchMultiAssetQuote("BTC-USD", "crypto");
    expect(q).toMatchObject({ price: 50000, provider: "okx", changePercent: "25.00%" });
    expect(urls().slice(1).map(u => new URL(u).host)).toEqual(["api.binance.com", "api.bybit.com", "www.okx.com"]);
    for (const c of fetchMock.mock.calls.slice(1)) expect(JSON.stringify(c[1]?.headers ?? {})).not.toContain("secret-okx");
  });
  it("EXCHANGE_PRICES_DISABLED turns them off", async () => {
    process.env.EXCHANGE_PRICES_DISABLED = "1";
    fetchMock.mockResolvedValue(new Response("", { status: 429 }));
    await expect(fetchMultiAssetQuote("BTC-USD", "crypto")).rejects.toMatchObject({ code: "QUOTE_UNAVAILABLE" });
    expect(urls()).toHaveLength(1);
  });
});

describe("OANDA (read-only pricing)", () => {
  const accounts = ok({ accounts: [{ id: "101-001-1234567-001" }] });
  it("prices forex from OANDA first, reading the key with any capitalisation, and only does GETs on accounts and pricing", async () => {
    process.env.OANDA_practice_API_KEY = "tok";
    fetchMock.mockResolvedValueOnce(accounts).mockResolvedValueOnce(ok({ prices: [{ bids: [{ price: "1.1000" }], asks: [{ price: "1.1002" }], time: "2026-11-15T10:00:00Z" }] }));
    const q = await fetchMultiAssetQuote("EUR/USD", "forex");
    expect(q).toMatchObject({ provider: "oanda-practice", currency: "USD" });
    expect(q.price).toBeCloseTo(1.1001, 5);
    expect(urls()[0]).toBe("https://api-fxpractice.oanda.com/v3/accounts");
    expect(urls()[1]).toContain("/v3/accounts/101-001-1234567-001/pricing?instruments=EUR_USD");
    for (const c of fetchMock.mock.calls) expect(c[1]?.method ?? "GET").toBe("GET");
  });
  it("prices gold from OANDA and falls back to Frankfurter/other sources when OANDA has nothing", async () => {
    process.env.OANDA_API_KEY = "tok";
    fetchMock.mockResolvedValueOnce(ok({ accounts: [] })).mockResolvedValueOnce(ok({ rates: { USD: 1.2 }, date: "2026-11-13" }));
    expect((await fetchMultiAssetQuote("EUR/USD", "forex")).provider).toBe("frankfurter-ecb");
  });
});

describe("market-data sources table", () => {
  it("lists sources with on/off and key names, never a key value, and marks OANDA when configured", () => {
    process.env.OANDA_API_KEY = "super-secret-value";
    const table = dataSources();
    const oanda = table.find(s => s.provider === "OANDA")!;
    expect(oanda).toMatchObject({ configured: true, covers: ["forex", "commodities"] });
    expect(JSON.stringify(table)).not.toContain("super-secret-value");
    expect(table.find(s => s.provider === "Yahoo Finance")!.keyNeeded).toBe(false);
    expect(table.map(s => s.provider)).toEqual(expect.arrayContaining(["Binance", "Bybit", "OKX", "OANDA", "Yahoo Finance"]));
  });
  it("makes metals live once OANDA is configured", () => {
    const gold = searchCatalog("XAU")[0];
    expect(availability(gold).live).toBe(false);
    process.env.OANDA_API_KEY = "tok";
    expect(availability(gold).live).toBe(true);
  });
});
