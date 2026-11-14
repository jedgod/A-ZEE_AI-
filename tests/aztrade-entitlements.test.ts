import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { paperExecutionEnabled, requireTradeFeature, resolveTradeEntitlements } from "@/lib/aztrade/entitlements";

describe("AZTrade entitlements", () => {
  it("blocks the free tier from backtesting and lets Plus and Premium in", () => {
    expect(() => requireTradeFeature(resolveTradeEntitlements("free"), "backtesting")).toThrow("SUBSCRIPTION_UPGRADE_REQUIRED");
    expect(() => requireTradeFeature(resolveTradeEntitlements("plus"), "backtesting")).not.toThrow();
    expect(() => requireTradeFeature(resolveTradeEntitlements("premium"), "backtesting")).not.toThrow();
  });

  it("gives Premium larger limits than Plus, and nothing to Free", () => {
    const [free, plus, premium] = (["free", "plus", "premium"] as const).map(resolveTradeEntitlements);
    expect(free.maximumBacktestBars).toBe(0);
    expect(premium.maximumBacktestBars).toBeGreaterThan(plus.maximumBacktestBars);
    expect(premium.maximumBacktestRunsPerDay).toBeGreaterThan(plus.maximumBacktestRunsPerDay);
  });

  it("rejects an unknown tier (including inherited object keys) and returns a copy that cannot change the policy", () => {
    expect(() => resolveTradeEntitlements("admin" as never)).toThrow("UNKNOWN_TIER");
    expect(() => resolveTradeEntitlements("constructor" as never)).toThrow("UNKNOWN_TIER");
    const mine = resolveTradeEntitlements("plus"); mine.maximumBacktestBars = 1e9;
    expect(resolveTradeEntitlements("plus").maximumBacktestBars).toBe(2000);
  });

  it("paper execution is open only when an operator has explicitly certified it", () => {
    expect(paperExecutionEnabled({})).toBe(false);
    expect(paperExecutionEnabled({ AZTRADE_PAPER_EXECUTION_CERTIFIED: "false" })).toBe(false);
    expect(paperExecutionEnabled({ AZTRADE_PAPER_EXECUTION_CERTIFIED: "1" })).toBe(false);
    expect(paperExecutionEnabled({ AZTRADE_PAPER_EXECUTION_CERTIFIED: "true" })).toBe(true);
  });

  it("the limits shown here match the limits the AZTrade backend enforces", () => {
    const source = readFileSync("AZTrade-Unified/backend/routes/strategies.js", "utf8");
    for (const tier of ["free", "plus", "premium"] as const) {
      const e = resolveTradeEntitlements(tier);
      expect(source).toContain(`${tier}: { maxBars: ${e.maximumBacktestBars}, runsPerDay: ${e.maximumBacktestRunsPerDay} }`);
    }
  });
});
