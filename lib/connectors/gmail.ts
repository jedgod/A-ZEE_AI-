import "server-only";
import { z } from "zod";
import { authBase, googleTokenRequest, revokeUrl, userinfoUrl } from "./google-drive";
import { ConnectorError, readOnly, type ConnectorProvider } from "./types";

// Gmail, read-only (gmail.readonly): search the inbox and read message headers and snippets.
// Same Google OAuth app as Drive (GOOGLE_CLIENT_ID / SECRET); register this callback URL too:
// {APP_ORIGIN}/api/connectors/gmail/callback. GMAIL_API_URL overrides the endpoint (tests).

const gmailBase = () => (process.env.GMAIL_API_URL || "https://gmail.googleapis.com").replace(/\/+$/, "");
const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/gmail.readonly"];
const MAX_RESULTS = 20;

export type MailSummary = { id: string; threadId: string; from: string; subject: string; date: string | null; snippet: string; unread: boolean };

export function gmailProvider(fetchImpl: typeof fetch = fetch): ConnectorProvider & {
  search(token: string, query?: string): Promise<{ messages: MailSummary[] }>;
} {
  const tokens = googleTokenRequest(fetchImpl);
  return {
    id: "gmail", label: "Gmail", requiredEnv: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    configured: () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    scopes: SCOPES, usesPkce: true,
    authorizeUrl: ({ state, codeChallenge, redirectUri }) => `${authBase()}/o/oauth2/v2/auth?${new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!, redirect_uri: redirectUri, response_type: "code", scope: SCOPES.join(" "),
      access_type: "offline", prompt: "consent", state, code_challenge: codeChallenge, code_challenge_method: "S256",
    })}`,
    exchangeCode: ({ code, codeVerifier, redirectUri }) => tokens({ code, code_verifier: codeVerifier, redirect_uri: redirectUri, grant_type: "authorization_code" }),
    refresh: refreshToken => tokens({ grant_type: "refresh_token", refresh_token: refreshToken }, refreshToken),
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
    /** Newest messages matching a Gmail search ("is:unread", "from:ana"); an empty query lists the inbox. */
    async search(token, query) {
      const params = new URLSearchParams({ maxResults: String(MAX_RESULTS), q: query?.trim().slice(0, 200) || "in:inbox" });
      const list = z.object({ messages: z.array(z.object({ id: z.string() })).optional() }).passthrough()
        .parse(JSON.parse(await readOnly(fetchImpl, `${gmailBase()}/gmail/v1/users/me/messages?${params}`, token)));
      const messages = await Promise.all((list.messages ?? []).map(async ({ id }) => {
        if (!/^[\w-]{5,100}$/.test(id)) throw new ConnectorError(502, "PROVIDER_UNAVAILABLE", "unexpected message id");
        const meta = new URLSearchParams([["format", "metadata"], ["metadataHeaders", "From"], ["metadataHeaders", "Subject"], ["metadataHeaders", "Date"]]);
        const m = z.object({
          id: z.string(), threadId: z.string(), snippet: z.string().optional(), labelIds: z.array(z.string()).optional(),
          payload: z.object({ headers: z.array(z.object({ name: z.string(), value: z.string() })).optional() }).passthrough().optional(),
        }).passthrough().parse(JSON.parse(await readOnly(fetchImpl, `${gmailBase()}/gmail/v1/users/me/messages/${id}?${meta}`, token)));
        const header = (name: string) => m.payload?.headers?.find(h => h.name.toLowerCase() === name)?.value ?? null;
        return {
          id: m.id, threadId: m.threadId, from: header("from") ?? "Unknown sender", subject: header("subject") ?? "(no subject)",
          date: header("date"), snippet: m.snippet ?? "", unread: Boolean(m.labelIds?.includes("UNREAD")),
        };
      }));
      return { messages };
    },
  };
}
