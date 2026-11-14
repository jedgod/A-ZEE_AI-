import { allow } from "@/lib/users/auth";
import { aztradeConfig, AztradeUnavailable, introspect } from "@/lib/aztrade/identity";
import { paperExecutionEnabled, resolveTradeEntitlements } from "@/lib/aztrade/entitlements";
import { quotaStatus } from "@/lib/aztrade/quota";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };

/**
 * GET with the 5-minute AZTrade token as a Bearer credential -> the account's plan and what it may do in AZTrade.
 * The token is verified, then the live session and subscription are re-checked on every call (identity.introspect),
 * so a sign-out or a plan change shows on the very next request.
 */
export async function GET(request: Request) {
  const match = /^Bearer ([^\s]{20,8192})$/.exec(request.headers.get("authorization") ?? "");
  if (!match) return Response.json({ error: "UNAUTHORIZED" }, { status: 401, headers });
  try {
    const config = aztradeConfig();
    const state = await introspect(match[1], config);
    if (!state.active) return Response.json({ error: "UNAUTHORIZED" }, { status: 401, headers });
    if (!await allow("aztrade-entitlements", state.sub, 60)) return Response.json({ error: "RATE_LIMITED" }, { status: 429, headers });
    // Today's usage is for display; the quota itself is enforced where the work runs. A failure here just leaves it out.
    const daily = await Promise.all([quotaStatus(state.sub, "backtest"), quotaStatus(state.sub, "research")]).then(([backtest, research]) => ({ backtest, research })).catch(() => null);
    return Response.json({
      plan: state.plan, tier: state.tier, ...resolveTradeEntitlements(state.tier),
      ...(daily ? { daily } : {}),
      marketData: { configured: false },   // no licensed provider is registered yet
      paperExecutionEnabled: paperExecutionEnabled(), realMoneyTradingEnabled: false,
    }, { headers });
  } catch (error) {
    if (error instanceof AztradeUnavailable) return Response.json({ error: "AZTRADE_UNAVAILABLE" }, { status: 503, headers });
    return Response.json({ error: "SERVICE_UNAVAILABLE" }, { status: 503, headers });
  }
}
