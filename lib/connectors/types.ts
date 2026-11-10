// Provider-neutral connector contracts. A provider handles OAuth (authorize URL, code exchange,
// refresh, revoke) and exposes read-only resource operations through ReadClient.

import { ollamaOnly } from "@/lib/pipeline/privacy";

export type ProviderId = "github" | "google_drive" | "gmail";

export type TokenSet = { accessToken: string; refreshToken?: string | null; expiresAt?: string | null; scopes: string[] };
export type ExternalAccount = { id: string; login: string };

export interface ConnectorProvider {
  id: ProviderId;
  label: string;
  /** Environment variables this provider needs (names only). */
  requiredEnv: string[];
  configured(): boolean;
  /** Scopes or permissions requested, shown to the user before connecting. */
  scopes: string[];
  usesPkce: boolean;
  authorizeUrl(input: { state: string; codeChallenge: string; redirectUri: string }): string;
  exchangeCode(input: { code: string; codeVerifier: string; redirectUri: string }): Promise<TokenSet>;
  refresh?(refreshToken: string): Promise<TokenSet>;
  revoke?(token: TokenSet): Promise<void>;
  account(accessToken: string): Promise<ExternalAccount>;
}

export class ConnectorError extends Error {
  constructor(public status: number, public code: string, message?: string) { super(message ?? code); }
}

/** Read-only HTTP for provider APIs: GET only, JSON or text, size-capped, with a timeout. */
export async function readOnly(fetchImpl: typeof fetch, url: string, accessToken: string, accept = "application/json", maxBytes = 2_000_000) {
  if (ollamaOnly()) throw new ConnectorError(403, "EXTERNAL_DATA_DISABLED");
  const response = await fetchImpl(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}`, Accept: accept, "User-Agent": "AZ_AI-connectors" },
    signal: AbortSignal.timeout(Number(process.env.CONNECTOR_TIMEOUT_MS) || 15_000),
  });
  if (response.status === 401) throw new ConnectorError(401, "CONNECTOR_UNAUTHORIZED");
  if (response.status === 403 || response.status === 404) throw new ConnectorError(response.status === 403 ? 403 : 404, response.status === 403 ? "PROVIDER_FORBIDDEN" : "NOT_FOUND");
  if (!response.ok) throw new ConnectorError(502, "PROVIDER_UNAVAILABLE", `HTTP ${response.status}`);
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > maxBytes) throw new ConnectorError(413, "FILE_TOO_LARGE");
  const text = await response.text();
  if (text.length > maxBytes) throw new ConnectorError(413, "FILE_TOO_LARGE");
  return text;
}
