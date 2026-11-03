import "server-only";
import { z } from "zod";
import { ConnectorError, readOnly, type ConnectorProvider, type TokenSet } from "./types";

// Google Drive, read-only (drive.readonly) with OAuth 2.0 authorization code + PKCE and offline
// access (refresh tokens). GOOGLE_OAUTH_URL / GOOGLE_TOKEN_URL / GOOGLE_API_URL override the
// endpoints (tests use a local fake).

const authBase = () => (process.env.GOOGLE_OAUTH_URL || "https://accounts.google.com").replace(/\/+$/, "");
const tokenUrl = () => process.env.GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token";
const revokeUrl = () => process.env.GOOGLE_REVOKE_URL || "https://oauth2.googleapis.com/revoke";
const apiBase = () => (process.env.GOOGLE_API_URL || "https://www.googleapis.com").replace(/\/+$/, "");
const userinfoUrl = () => process.env.GOOGLE_USERINFO_URL || "https://openidconnect.googleapis.com/v1/userinfo";
const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/drive.readonly"];
const GOOGLE_DOC_EXPORTS: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
};
const TEXT_TYPES = /^(text\/|application\/(json|xml|javascript|x-yaml|yaml|x-sh|sql))/;

async function tokenRequest(fetchImpl: typeof fetch, params: Record<string, string>, previousRefresh?: string): Promise<TokenSet> {
  const response = await fetchImpl(tokenUrl(), {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, ...params }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new ConnectorError(400, "OAUTH_EXCHANGE_FAILED", data.error_description ?? data.error);
  const t = z.object({ access_token: z.string(), refresh_token: z.string().optional(), expires_in: z.number().optional(), scope: z.string().optional() }).passthrough().parse(data);
  return {
    accessToken: t.access_token, refreshToken: t.refresh_token ?? previousRefresh ?? null,
    expiresAt: t.expires_in ? new Date(Date.now() + t.expires_in * 1000).toISOString() : null,
    scopes: (t.scope ?? "").split(" ").filter(Boolean),
  };
}

export type DriveFile = { id: string; name: string; mimeType: string; modifiedTime: string | null; size: number | null; webViewLink: string | null; readable: boolean };

export function googleDriveProvider(fetchImpl: typeof fetch = fetch): ConnectorProvider & {
  listFiles(token: string, query?: string, pageToken?: string): Promise<{ files: DriveFile[]; nextPageToken: string | null }>;
  fileText(token: string, id: string): Promise<{ id: string; name: string; mimeType: string; content: string }>;
} {
  const readable = (mime: string) => Boolean(GOOGLE_DOC_EXPORTS[mime]) || TEXT_TYPES.test(mime);
  return {
    id: "google_drive", label: "Google Drive", requiredEnv: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    configured: () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    scopes: SCOPES, usesPkce: true,
    authorizeUrl: ({ state, codeChallenge, redirectUri }) => `${authBase()}/o/oauth2/v2/auth?${new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!, redirect_uri: redirectUri, response_type: "code", scope: SCOPES.join(" "),
      access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
      code_challenge: codeChallenge, code_challenge_method: "S256",
    })}`,
    exchangeCode: ({ code, codeVerifier, redirectUri }) => tokenRequest(fetchImpl, { code, code_verifier: codeVerifier, redirect_uri: redirectUri, grant_type: "authorization_code" }),
    refresh: refreshToken => tokenRequest(fetchImpl, { grant_type: "refresh_token", refresh_token: refreshToken }, refreshToken),
    async revoke(token) {
      await fetchImpl(revokeUrl(), {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: token.refreshToken || token.accessToken }), signal: AbortSignal.timeout(15_000),
      }).catch(() => {});
    },
    async account(token) {
      const info = z.object({ sub: z.string(), email: z.string().optional() }).passthrough().parse(JSON.parse(await readOnly(fetchImpl, userinfoUrl(), token)));
      return { id: info.sub, login: info.email ?? info.sub };
    },
    async listFiles(token, query, pageToken) {
      const clauses = ["trashed = false"];
      if (query?.trim()) clauses.push(`name contains '${query.trim().slice(0, 100).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`);
      const params = new URLSearchParams({
        q: clauses.join(" and "), pageSize: "50", orderBy: "modifiedTime desc",
        fields: "nextPageToken, files(id, name, mimeType, modifiedTime, size, webViewLink)", ...(pageToken ? { pageToken } : {}),
      });
      const data = z.object({
        nextPageToken: z.string().optional(),
        files: z.array(z.object({ id: z.string(), name: z.string(), mimeType: z.string(), modifiedTime: z.string().optional(), size: z.string().optional(), webViewLink: z.string().optional() }).passthrough()),
      }).passthrough().parse(JSON.parse(await readOnly(fetchImpl, `${apiBase()}/drive/v3/files?${params}`, token)));
      return {
        nextPageToken: data.nextPageToken ?? null,
        files: data.files.map(f => ({ id: f.id, name: f.name, mimeType: f.mimeType, modifiedTime: f.modifiedTime ?? null, size: f.size ? Number(f.size) : null, webViewLink: f.webViewLink ?? null, readable: readable(f.mimeType) })),
      };
    },
    async fileText(token, id) {
      if (!/^[\w-]{5,200}$/.test(id)) throw new ConnectorError(400, "INVALID_FILE_ID");
      const meta = z.object({ id: z.string(), name: z.string(), mimeType: z.string(), size: z.string().optional() }).passthrough()
        .parse(JSON.parse(await readOnly(fetchImpl, `${apiBase()}/drive/v3/files/${id}?fields=id,name,mimeType,size`, token)));
      const exportAs = GOOGLE_DOC_EXPORTS[meta.mimeType];
      if (!exportAs && !TEXT_TYPES.test(meta.mimeType)) throw new ConnectorError(415, "NOT_A_TEXT_FILE");
      const url = exportAs ? `${apiBase()}/drive/v3/files/${id}/export?mimeType=${encodeURIComponent(exportAs)}` : `${apiBase()}/drive/v3/files/${id}?alt=media`;
      return { id: meta.id, name: meta.name, mimeType: meta.mimeType, content: await readOnly(fetchImpl, url, token, exportAs ?? "*/*", 2_000_000) };
    },
  };
}
