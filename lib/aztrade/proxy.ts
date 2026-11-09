import "server-only";
import { allow, requireUser, userFailure } from "@/lib/users/auth";
import { UserError } from "@/lib/users/types";
import { AztradeUnavailable, mintToken } from "./identity";
import { JwtError } from "./jwt";

// The browser never holds an AZTrade token and never talks to the AZTrade API. Signed-in pages call /api/trade/*; this proxy
// authenticates the A-Zee session, mints a short-lived token for THAT live session, and forwards ONE allow-listed request to the
// AZTrade API over the private network. The path is chosen from the allow-list, never from user input, so there is nothing to
// traverse, and anything not listed is refused.

type Route = { method: "GET" | "POST"; match: RegExp; to: (m: RegExpMatchArray) => string; body?: boolean };
export const ROUTES: Route[] = [
  { method: "GET", match: /^account$/, to: () => "/api/paper/" },
  { method: "POST", match: /^orders$/, to: () => "/api/paper/orders", body: true },
  { method: "GET", match: /^markets\/status$/, to: () => "/api/markets/status" },
  { method: "GET", match: /^markets$/, to: () => "/api/markets" },
  { method: "GET", match: /^assistant\/history$/, to: () => "/api/assistant/history" },
  { method: "POST", match: /^assistant\/chat$/, to: () => "/api/assistant/chat", body: true },
  { method: "GET", match: /^strategies$/, to: () => "/api/strategies" },
  { method: "POST", match: /^strategies\/(momentum|mean-reversion)\/backtest$/, to: m => `/api/strategies/${m[1]}/backtest`, body: true },
];
const MAX_BODY = 16_000;
const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** The AZTrade API base. https is required outside local development, so a token is never sent in clear over a network. */
export function tradeBase(env: Record<string, string | undefined> = process.env): URL {
  const raw = env.AZTRADE_API_URL;
  if (!raw) throw new AztradeUnavailable("AZTRADE_API_URL is not configured");
  const url = new URL(raw);
  const local = env.NODE_ENV !== "production" && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !local) throw new AztradeUnavailable("AZTRADE_API_URL must use https");
  return url;
}

export async function forward(request: Request, segments: string[]): Promise<Response> {
  const path = segments.join("/");
  const route = ROUTES.find(r => r.method === request.method && r.match.test(path));
  if (!route) return json({ error: "NOT_FOUND" }, 404);
  try {
    const user = await requireUser(request, request.method !== "GET");
    if (!await allow("aztrade-proxy", user.id, 180)) throw new UserError(429, "RATE_LIMITED");
    const base = tradeBase();
    let body: string | undefined;
    if (route.body) {
      body = await request.text();
      if (body.length > MAX_BODY) return json({ error: "TOO_LARGE" }, 413);
      try { if (typeof JSON.parse(body) !== "object") throw new Error(); } catch { return json({ error: "INVALID_REQUEST" }, 400); }
    }
    const { access_token } = await mintToken(request);              // identity comes from the live session, never from the request
    const target = new URL(route.to(path.match(route.match)!), base);
    const upstream = await fetch(target, { method: route.method, redirect: "manual", signal: AbortSignal.timeout(35_000), body,
      headers: { authorization: `Bearer ${access_token}`, "content-type": "application/json", accept: "application/json" } });
    const text = (await upstream.text()).slice(0, 2_000_000);
    return new Response(text, { status: upstream.status, headers: { "content-type": "application/json", "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AztradeUnavailable) return json({ error: "TRADE_UNAVAILABLE" }, 503);
    if (error instanceof JwtError) return json({ error: "SIGN_IN_REQUIRED" }, 401);
    if (error instanceof UserError) return userFailure(error);
    console.error("aztrade proxy error", (error as Error).message);
    return json({ error: "TRADE_UNAVAILABLE" }, 503);                   // the upstream is down or unreachable: fail closed
  }
}
