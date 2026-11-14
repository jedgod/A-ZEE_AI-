/** AZTrade mobile API client: existing A-Zee account identity, NO independent login. */
import { API_CONFIGURED, API_URL } from "./config";
import { getInstallId, loadToken } from "./storage";

type Json = Record<string, unknown>;
export type Capabilities = {
  product: string;
  plan: string;
  tier: string;
  capabilities: {
    researchAssistant: boolean;
    marketData: "licensed" | "unavailable";
    historicalBacktests: "certified" | "unavailable";
    brokerConnections: "read_only" | "unavailable";
    paperExecution: false;
    liveExecution: false;
  };
};
export type Position = { symbol: string; shares: string; entry_price?: string; current_price?: string | null; market_value?: string | null };
export type PaperAccount = { accountId: string; cash: string; positions: Position[]; history?: unknown[]; paperMode?: boolean };
export type Entitlements = {
  plan: string; tier: string; aiAssistant: boolean; backtesting: boolean;
  maximumBacktestBars: number; maximumBacktestRunsPerDay: number; maximumResearchPerDay: number;
  daily?: { backtest: { used: number; limit: number }; research: { used: number; limit: number } };
  marketData: { configured: boolean };
  paperExecutionEnabled: boolean; realMoneyTradingEnabled: boolean;
};
export type Intelligence = { researchAvailable?: boolean; marketDataConfigured?: boolean };
export type RiskReport = { status?: string; missingSymbols?: string[]; totals?: { currency: string; marketValue: number; largestPositionPct: number; byAssetClassPct: Record<string, number> } | null };
export type ResearchReply = { reply: string; market_data_status?: string };
export type ResearchMessage = { role: "user" | "assistant"; content: string; created_at?: string };

export class AZTradeError extends Error {
  constructor(public status: number, public code: string) { super(code); this.name = "AZTradeError"; }
}

const MAX_RESPONSE = 512_000;
const TOKEN_TTL_MS = 230_000; // shorter than server's five-minute AZTrade token
const asRecord = (x: unknown): Json => x && typeof x === "object" && !Array.isArray(x) ? x as Json : {};
const errorCode = (x: unknown) => typeof asRecord(x).error === "string" ? asRecord(x).error as string : "REQUEST_FAILED";

// In-memory only. Clear on unmount and user switches; never write AZTrade JWT to disk.
export function createAZTradeClient() {
  let tradeToken: string | null = null;
  let tokenUntil = 0;
  let lastAzeeSession: string | null = null;
  let pendingMint: Promise<string> | null = null;

  function clear() { tradeToken = null; tokenUntil = 0; lastAzeeSession = null; pendingMint = null; }

  async function request(path: string, options: { method?: "GET" | "POST"; body?: Json; trade?: boolean; tradeAsBearer?: boolean; signal?: AbortSignal } = {}): Promise<unknown> {
    if (!API_CONFIGURED) throw new AZTradeError(0, "AZEE_SERVER_NOT_CONFIGURED");
    const session = await loadToken();
    if (!session) { clear(); throw new AZTradeError(401, "SIGN_IN_REQUIRED"); }
    if (lastAzeeSession && lastAzeeSession !== session) clear();
    lastAzeeSession = session;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${session}`,
      "X-AZ-Client": "mobile",
      "X-AZ-Device": await getInstallId(),
      Accept: "application/json",
    };
    if (options.trade) headers["X-AZTrade-Token"] = `Bearer ${await mint(options.signal)}`;
    // The entitlements route takes the AZTrade token itself as its Bearer credential.
    if (options.tradeAsBearer) headers.Authorization = `Bearer ${await mint(options.signal)}`;
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    let response: Response;
    try {
      response = await fetch(`${API_URL}${path}`, {
        method: options.method ?? "GET", headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: options.signal,
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      throw new AZTradeError(0, "NETWORK_UNAVAILABLE");
    }
    const text = await response.text();
    if (text.length > MAX_RESPONSE) throw new AZTradeError(502, "RESPONSE_TOO_LARGE");
    let data: unknown;
    try { data = JSON.parse(text); } catch { throw new AZTradeError(502, "INVALID_SERVER_RESPONSE"); }
    if (!response.ok) throw new AZTradeError(response.status, errorCode(data));
    return data;
  }

  async function mint(signal?: AbortSignal): Promise<string> {
    if (tradeToken && Date.now() < tokenUntil) return tradeToken;
    if (pendingMint) return pendingMint;
    // Mint is authenticated with the existing mobile session, not an AZTrade token.
    pendingMint = (async () => {
      const body = asRecord(await request("/api/aztrade/token", { method: "POST", body: {}, signal }));
      if (typeof body.access_token !== "string" || body.access_token.length < 20)
        throw new AZTradeError(502, "INVALID_AZTRADE_TOKEN_RESPONSE");
      tradeToken = body.access_token;
      tokenUntil = Date.now() + TOKEN_TTL_MS;
      return tradeToken;
    })();
    try { return await pendingMint; }
    finally { pendingMint = null; }
  }

  async function companion(resource: "paper" | "portfolio" | "risk" | "assistant/history" | "assistant/chat" | "intelligence/status" | "intelligence/portfolio/risk" | "intelligence/brokers", body?: Json, signal?: AbortSignal): Promise<unknown> {
    const execute = () => request(`/api/aztrade/companion?resource=${resource}`, { method: body ? "POST" : "GET", body, trade: true, signal });
    try { return await execute(); }
    catch (e) {
      if (e instanceof AZTradeError && e.status === 401 && e.code !== "SIGN_IN_REQUIRED") {
        tradeToken = null; tokenUntil = 0;
        // Only one retry; requestId in `body` is unchanged for idempotent AI requests.
        return execute();
      }
      throw e;
    }
  }

  return {
    clear,
    capabilities: (signal?: AbortSignal) => request("/api/aztrade/capabilities", { signal }) as Promise<Capabilities>,
    entitlements: (signal?: AbortSignal) => request("/api/aztrade/entitlements", { tradeAsBearer: true, signal }) as Promise<Entitlements>,
    intelligenceStatus: (signal?: AbortSignal) => companion("intelligence/status", undefined, signal) as Promise<Intelligence>,
    portfolioRisk: (signal?: AbortSignal) => companion("intelligence/portfolio/risk", undefined, signal) as Promise<RiskReport>,
    paper: (signal?: AbortSignal) => companion("paper", undefined, signal) as Promise<PaperAccount>,
    portfolio: (signal?: AbortSignal) => companion("portfolio", undefined, signal),
    risk: (signal?: AbortSignal) => companion("risk", undefined, signal),
    history: (signal?: AbortSignal) => companion("assistant/history", undefined, signal) as Promise<ResearchMessage[]>,
    research: (requestId: string, message: string, signal?: AbortSignal) => companion("assistant/chat", { requestId, message }, signal) as Promise<ResearchReply>,
  };
}
