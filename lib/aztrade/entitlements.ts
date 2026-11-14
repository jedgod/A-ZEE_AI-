import type { Tier } from "@/lib/linqext/policy";

// What each A-Zee plan tier may do inside AZTrade. The TIER comes from A-Zee's live subscription lookup (identity.ts),
// never from anything in the token. These numbers are DISPLAYED to the user here and ENFORCED by the AZTrade backend
// (AZTrade-Unified/backend/routes/strategies.js, BACKTEST_PLAN_LIMITS): keep the two in step (a test checks the values).

export type TradeEntitlements = {
  research: boolean;
  portfolioRead: boolean;
  backtesting: boolean;
  aiAssistant: boolean;
  maximumBacktestBars: number;
  maximumBacktestRunsPerDay: number;
  /** AI research questions a day (on top of the plan's monthly AZTrade allowance). */
  maximumResearchPerDay: number;
};

const POLICIES: Record<Tier, TradeEntitlements> = {
  free: { research: true, portfolioRead: true, backtesting: false, aiAssistant: true, maximumBacktestBars: 0, maximumBacktestRunsPerDay: 0, maximumResearchPerDay: 5 },
  plus: { research: true, portfolioRead: true, backtesting: true, aiAssistant: true, maximumBacktestBars: 2000, maximumBacktestRunsPerDay: 10, maximumResearchPerDay: 25 },
  premium: { research: true, portfolioRead: true, backtesting: true, aiAssistant: true, maximumBacktestBars: 10000, maximumBacktestRunsPerDay: 50, maximumResearchPerDay: 100 },
};

export function resolveTradeEntitlements(tier: Tier): TradeEntitlements {
  const policy = Object.hasOwn(POLICIES, tier) ? POLICIES[tier] : undefined;
  if (!policy) throw new Error("UNKNOWN_TIER");
  return { ...policy };
}

export function requireTradeFeature(entitlements: TradeEntitlements, feature: "research" | "portfolioRead" | "backtesting" | "aiAssistant") {
  if (!entitlements[feature]) throw new Error("SUBSCRIPTION_UPGRADE_REQUIRED");
}

/** Whether simulated order execution is open. It is only ever true when an operator has certified it; real money is never enabled. */
export const paperExecutionEnabled = (env: Record<string, string | undefined> = process.env) => env.AZTRADE_PAPER_EXECUTION_CERTIFIED === "true";
