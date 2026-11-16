import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { namedAssets, wantsMarketData } from "@/lib/pipeline/market-context";

describe("market context", () => {
  it("recognises market-rate questions", () => {
    for (const q of ["can you say the rate for the trading market for the day", "what is the price of bitcoin?", "how is Tesla doing today", "EUR/USD rate now", "how's the stock market", "gold price"]) expect(wantsMarketData(q), q).toBe(true);
  });
  it("ignores everything else", () => {
    for (const q of ["write a poem about the sea", "explain how a market economy works historically", "hi", "what is the rate of photosynthesis"]) expect(wantsMarketData(q), q).toBe(false);
  });
  it("finds the assets named", () => {
    expect(namedAssets("price of bitcoin and gold").map(e => e.symbol).sort()).toEqual(["BTC-USD", "XAU-USD"].sort());
    expect(namedAssets("How is AAPL vs Tesla").map(e => e.symbol).sort()).toEqual(["AAPL", "TSLA"]);
    expect(namedAssets("what is the rate for the trading market")).toEqual([]);
    expect(namedAssets("I saw a v8 engine").map(e => e.symbol)).not.toContain("V");
  });
});
