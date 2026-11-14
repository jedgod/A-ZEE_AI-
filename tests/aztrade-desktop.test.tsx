import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  chartDomain, DEFAULT_WATCH, fmtMoney, fmtPct, fmtPrice, guessClass, indexOfTime, panWindow, parseWatch, percentOk, ruleLine, sma, valuate, zoomWindow,
  type Point, type QuoteState,
} from "@/app/aztrade/logic";
import { Sparkline } from "@/app/aztrade/Sparkline";
import { PortfolioPanel } from "@/app/aztrade/PortfolioPanel";
import { AssetPicker } from "@/app/aztrade/AssetPicker";
import { PriceChart } from "@/app/aztrade/PriceChart";
import { MonitorsPanel } from "@/app/aztrade/MonitorsPanel";
import { MarketsPanel } from "@/app/aztrade/MarketsPanel";

describe("desktop AZTrade logic", () => {
  it("guesses an asset class from a typed symbol", () => {
    expect(guessClass("BTC-USD")).toBe("crypto");
    expect(guessClass("EUR/USD")).toBe("forex");
    expect(guessClass("XAU-USD")).toBe("commodities");
    expect(guessClass("TSLA")).toBe("stocks_etfs");
    expect(percentOk("crypto") && percentOk("stocks_etfs")).toBe(true);
    expect(percentOk("forex") || percentOk("commodities")).toBe(false);
  });
  it("the watchlist survives bad stored data and only keeps valid, unique symbols", () => {
    expect(parseWatch(null)).toEqual(DEFAULT_WATCH);
    expect(parseWatch("not json")).toEqual(DEFAULT_WATCH);
    expect(parseWatch('{"a":1}')).toEqual(DEFAULT_WATCH);
    const out = parseWatch(JSON.stringify([{ symbol: "AAPL", assetClass: "stocks_etfs" }, { symbol: "AAPL", assetClass: "stocks_etfs" }, { symbol: "bad symbol", assetClass: "crypto" }, { symbol: "BTC-USD", assetClass: "weird" }, { symbol: "ETH-USD", assetClass: "crypto" }]));
    expect(out.map(i => i.symbol)).toEqual(["AAPL", "ETH-USD"]);
    expect(parseWatch(JSON.stringify(Array.from({ length: 80 }, (_, i) => ({ symbol: `S${i}`, assetClass: "stocks_etfs" })))).length).toBe(50);
  });
  it("values the practice account only when every holding has a price", () => {
    const quotes: QuoteState = { "BTC-USD": { quote: { price: 60000, currency: "USD", provider: "coingecko" } }, AAPL: { error: "PROVIDER_NOT_CONFIGURED" } };
    const cls = (s: string) => guessClass(s);
    const cashOnly = valuate(100000, [], quotes, cls)!;
    expect(cashOnly).toMatchObject({ complete: true, total: 100000, largest: null });
    expect(cashOnly.pct(cashOnly.byClass.Cash)).toBe(100);
    const partial = valuate(100000, [{ symbol: "BTC-USD", shares: "0.5" }, { symbol: "AAPL", shares: "10" }], quotes, cls)!;
    expect(partial.complete).toBe(false);
    expect(partial.missing).toEqual(["AAPL"]);
    expect(partial.largest).toBeNull();          // no claimed concentration on incomplete data
    const full = valuate(100000, [{ symbol: "BTC-USD", shares: "0.5" }], quotes, cls)!;
    expect(full).toMatchObject({ complete: true, total: 130000 });
    expect(full.byClass.Crypto).toBe(30000);
    expect(Math.round(full.largest!)).toBe(23);
    expect(valuate(NaN, [], quotes, cls)).toBeNull();
    expect(valuate(10, [{ symbol: "BTC-USD", shares: "abc" }], quotes, cls)!.complete).toBe(false);   // an unreadable quantity is not valued
  });
  it("chart domain: the alert level stretches the scale only when it is near the data", () => {
    const near = chartDomain([100, 110], 95);
    expect(near.levelInside).toBe(true);
    expect(near.min).toBeLessThan(95);
    const far = chartDomain([100, 110], 10);
    expect(far.levelInside).toBe(false);
    expect(far.min).toBeGreaterThan(80);
    expect(chartDomain([5, 5], null).max).toBeGreaterThan(chartDomain([5, 5], null).min);   // a flat line still has a scale
  });
  it("zoom and pan keep the window inside the data", () => {
    expect(zoomWindow(0, 99, 100, 2, 0.5)).toEqual([25, 74]);
    const [a, b] = zoomWindow(0, 99, 100, 1000, 0.5);
    expect(b - a).toBeGreaterThanOrEqual(6);
    expect(zoomWindow(20, 40, 100, 0.01, 0.5)).toEqual([0, 99]);     // zooming out stops at the full range
    expect(panWindow(10, 30, 100, -50)).toEqual([0, 20]);
    expect(panWindow(10, 30, 100, 500)).toEqual([79, 99]);
  });
  it("time lookup and moving averages", () => {
    const pts: Point[] = [10, 20, 30, 40].map((t, i) => ({ t, c: i + 1 }));
    expect(indexOfTime(pts, 5)).toBeNull();
    expect(indexOfTime(pts, 25)).toBe(1.5);
    expect(indexOfTime(pts, 40)).toBe(3);
    expect(sma(pts, 2)).toEqual([null, 1.5, 2.5, 3.5]);
  });
  it("formats like the phone app", () => {
    expect(fmtPrice(68987.08)).toBe("68,987.08");
    expect(fmtPrice(1.1081, true)).toBe("1.1081");
    expect(fmtPct(-6.05)).toBe("-6.05%");
    expect(fmtMoney("100000.00000000")).toBe("$100,000.00");
    expect(fmtMoney(null)).toBe("Unavailable");
    expect(ruleLine({ rule_type: "price_below", threshold: "68987.08", recurrence: "once" }, "crypto")).toBe("Crosses below 68,987.08 USD · once");
    expect(ruleLine({ rule_type: "pct_drop_24h", threshold: "7.000000", recurrence: "each_crossing" }, "crypto")).toBe("Drops by 7% in 24h · each crossing");
  });
});

describe("desktop AZTrade components render (server-side first paint)", () => {
  it("sparkline draws a line, and nothing for too few points", () => {
    expect(renderToString(createElement(Sparkline, { points: [1, 2, 3, 2, 4] }))).toContain("<path");
    expect(renderToString(createElement(Sparkline, { points: [1] }))).toBe("");
  });
  it("portfolio shows cash-only valuation honestly, and Unavailable when not connected", () => {
    const val = valuate(100000, [], {}, guessClass)!;
    const html = renderToString(createElement(PortfolioPanel, { valuation: val, connected: true, positionCount: 0 }));
    expect(html).toContain("$100,000.00");
    expect(html).toContain("Practice cash only. No holdings yet.");
    expect(html).toContain("No practice holdings are recorded");
    const none = renderToString(createElement(PortfolioPanel, { valuation: null, connected: false, positionCount: 0 }));
    expect(none).toContain("Unavailable");
    expect(none).not.toContain("$");
  });
  it("the picker, chart, monitors and markets panels mount without crashing", () => {
    expect(renderToString(createElement(AssetPicker, { value: { symbol: "BTC-USD", assetClass: "crypto" }, onChange: () => undefined }))).toContain("BTC-USD");
    const chart = renderToString(createElement(PriceChart, { asset: { symbol: "BTC-USD", assetClass: "crypto" }, onAssetChange: () => undefined, onCreateAlert: async () => undefined }));
    expect(chart).toContain("Range");
    expect(chart).toContain("Candles");
    expect(chart).toContain("Loading history");
    const forexChart = renderToString(createElement(PriceChart, { asset: { symbol: "EUR/USD", assetClass: "forex" } }));
    expect(forexChart).toContain("daily data only");     // forex cannot show 1D
    expect(renderToString(createElement(MonitorsPanel, {}))).toContain("Activate monitor");
    const markets = renderToString(createElement(MarketsPanel, { watch: DEFAULT_WATCH, onAdd: () => undefined, onRemove: () => undefined, quotes: {}, quotesBusy: false, reloadQuotes: () => undefined, marketsLive: false, onMonitor: () => undefined, onMonitorCreated: () => undefined }));
    expect(markets.replace(/<!-- -->/g, "")).toContain("My watchlist (5)");
    expect(markets).toContain("AAPL");
  });
});
