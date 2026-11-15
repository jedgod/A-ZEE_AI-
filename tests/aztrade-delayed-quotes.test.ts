import { beforeEach, describe, expect, it, vi } from "vitest";

const batch = vi.hoisted(() => ({ fetchQuoteBatch: vi.fn() }));
vi.mock("@/lib/finance/batch", () => batch);

import { delayedQuotesFor, mentionedAssets } from "@/lib/aztrade/delayed-quotes";

const symbols = (m: string) => mentionedAssets(m).map(e => e.symbol);

describe("which assets a research question names", () => {
  it("finds BTC in the question from the user's screenshot, and nothing for 'certificate of deposit' or a bare 'ETF'", () => {
    expect(symbols("what is the rate for certificate of deposit, ETF and BTC?")).toEqual(["BTC-USD"]);
  });
  it("matches by ticker, by pair and by first name, in any case", () => {
    expect(symbols("how risky is bitcoin vs eth?")).toEqual(["BTC-USD", "ETH-USD"]);
    expect(symbols("EUR/USD outlook")).toEqual(["EUR/USD"]);
    expect(symbols("Is Tesla or AAPL a better hold?")).toEqual(["AAPL", "TSLA"]);
    expect(symbols("btc-usd trend")).toEqual(["BTC-USD"]);
  });
  it("a one-letter ticker only matches in capitals, and words that merely contain a ticker do not match", () => {
    expect(symbols("is V a good stock")).toContain("V");
    expect(symbols("a very good value")).not.toContain("V");
    expect(symbols("a metaphor about ethics")).toEqual([]);
  });
  it("never names more than five assets", () => {
    expect(mentionedAssets("BTC ETH SOL XRP ADA DOGE LTC DOT").length).toBe(5);
  });
});

describe("delayed quotes for the question", () => {
  beforeEach(() => batch.fetchQuoteBatch.mockReset());

  it("returns the price, a 'delayed' source label and the observation time for what is priced", async () => {
    batch.fetchQuoteBatch.mockResolvedValue([{ symbol: "BTC-USD", assetClass: "crypto", quote: { symbol: "BTC-USD", assetClass: "crypto", price: 64515.56, currency: "USD", provider: "coingecko", asOf: "2026-11-14T22:00:00.000Z", notice: "" } }]);
    expect(await delayedQuotesFor("what is BTC at?")).toEqual([{ symbol: "BTC-USD", price: "64515.56", source: "coingecko (delayed)", observed_at: "2026-11-14T22:00:00.000Z" }]);
    expect(batch.fetchQuoteBatch).toHaveBeenCalledWith([{ symbol: "BTC-USD", assetClass: "crypto" }]);
  });
  it("leaves out assets that came back without a price, and asks for nothing when no asset is named", async () => {
    batch.fetchQuoteBatch.mockResolvedValue([{ symbol: "BTC", assetClass: "crypto", error: "QUOTE_UNAVAILABLE" }]);
    expect(await delayedQuotesFor("BTC?")).toEqual([]);
    batch.fetchQuoteBatch.mockClear();
    expect(await delayedQuotesFor("how do certificates of deposit work?")).toEqual([]);
    expect(batch.fetchQuoteBatch).not.toHaveBeenCalled();
  });
  it("refuses a price that cannot be written as a plain decimal", async () => {
    batch.fetchQuoteBatch.mockResolvedValue([{ symbol: "BTC", assetClass: "crypto", quote: { symbol: "BTC-USD", assetClass: "crypto", price: Number.POSITIVE_INFINITY, currency: "USD", provider: "x", notice: "" } }]);
    expect(await delayedQuotesFor("BTC")).toEqual([]);
  });
});
