import "server-only";
import { z } from "zod";
import { ConnectorError, readOnly, type ConnectorProvider, type TokenSet } from "./types";

// GitHub. Recommended: a GitHub App with repository "Contents: Read-only" and "Metadata:
// Read-only" permissions (user-to-server tokens; GitHub Apps can't be given write access by this
// code because it only issues GET requests). A classic OAuth App also works, but GitHub's "repo"
// scope can't be read-only for private repositories; GITHUB_SCOPES lets you narrow it
// (e.g. "read:user public_repo").
// GITHUB_OAUTH_URL / GITHUB_API_URL override the endpoints (tests use a local fake).

const oauthBase = () => (process.env.GITHUB_OAUTH_URL || "https://github.com").replace(/\/+$/, "");
const apiBase = () => (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/+$/, "");
const scopes = () => (process.env.GITHUB_SCOPES || "read:user repo").split(/\s+/).filter(Boolean);

const tokenSchema = z.object({
  access_token: z.string().min(1), refresh_token: z.string().optional(), expires_in: z.number().optional(), scope: z.string().optional(),
  error: z.string().optional(),
});
const toTokens = (t: z.infer<typeof tokenSchema>): TokenSet => ({
  accessToken: t.access_token, refreshToken: t.refresh_token ?? null,
  expiresAt: t.expires_in ? new Date(Date.now() + t.expires_in * 1000).toISOString() : null,
  scopes: (t.scope ?? "").split(/[ ,]+/).filter(Boolean),
});

async function tokenRequest(fetchImpl: typeof fetch, params: Record<string, string>) {
  const response = await fetchImpl(`${oauthBase()}/login/oauth/access_token`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GITHUB_CLIENT_ID!, client_secret: process.env.GITHUB_CLIENT_SECRET!, ...params }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error || !data.access_token) throw new ConnectorError(400, "OAUTH_EXCHANGE_FAILED", data.error_description ?? data.error);
  return toTokens(tokenSchema.parse(data));
}

export function githubProvider(fetchImpl: typeof fetch = fetch): ConnectorProvider & {
  listRepos(token: string): Promise<{ fullName: string; private: boolean; defaultBranch: string; description: string | null; updatedAt: string }[]>;
  tree(token: string, owner: string, repo: string, ref?: string): Promise<{ ref: string; truncated: boolean; files: { path: string; size: number }[] }>;
  file(token: string, owner: string, repo: string, path: string, ref?: string): Promise<{ path: string; size: number; content: string; sha: string }>;
} {
  return {
    id: "github", label: "GitHub", requiredEnv: ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"],
    configured: () => Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
    scopes: scopes(), usesPkce: false,
    authorizeUrl: ({ state, redirectUri }) => `${oauthBase()}/login/oauth/authorize?${new URLSearchParams({
      client_id: process.env.GITHUB_CLIENT_ID!, redirect_uri: redirectUri, scope: scopes().join(" "), state, allow_signup: "false",
    })}`,
    exchangeCode: ({ code, redirectUri }) => tokenRequest(fetchImpl, { code, redirect_uri: redirectUri }),
    refresh: refreshToken => tokenRequest(fetchImpl, { grant_type: "refresh_token", refresh_token: refreshToken }),
    async revoke(token) {
      // Removes the app's grant for this user (best effort).
      const basic = Buffer.from(`${process.env.GITHUB_CLIENT_ID}:${process.env.GITHUB_CLIENT_SECRET}`).toString("base64");
      await fetchImpl(`${apiBase()}/applications/${process.env.GITHUB_CLIENT_ID}/grant`, {
        method: "DELETE", headers: { Authorization: `Basic ${basic}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: token.accessToken }), signal: AbortSignal.timeout(15_000),
      }).catch(() => {});
    },
    async account(token) {
      const user = z.object({ id: z.number(), login: z.string() }).parse(JSON.parse(await readOnly(fetchImpl, `${apiBase()}/user`, token, "application/vnd.github+json")));
      return { id: String(user.id), login: user.login };
    },
    async listRepos(token) {
      const repos = z.array(z.object({
        full_name: z.string(), private: z.boolean(), default_branch: z.string(), description: z.string().nullable(), updated_at: z.string(),
      }).passthrough()).parse(JSON.parse(await readOnly(fetchImpl, `${apiBase()}/user/repos?per_page=100&sort=updated`, token, "application/vnd.github+json")));
      return repos.map(r => ({ fullName: r.full_name, private: r.private, defaultBranch: r.default_branch, description: r.description, updatedAt: r.updated_at }));
    },
    async tree(token, owner, repo, ref) {
      const branch = ref || (z.object({ default_branch: z.string() }).passthrough().parse(JSON.parse(await readOnly(fetchImpl, `${apiBase()}/repos/${owner}/${repo}`, token, "application/vnd.github+json")))).default_branch;
      const data = z.object({
        truncated: z.boolean().optional(),
        tree: z.array(z.object({ path: z.string(), type: z.string(), size: z.number().optional() }).passthrough()),
      }).passthrough().parse(JSON.parse(await readOnly(fetchImpl, `${apiBase()}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, token, "application/vnd.github+json", 20_000_000)));
      return { ref: branch, truncated: Boolean(data.truncated), files: data.tree.filter(t => t.type === "blob").map(t => ({ path: t.path, size: t.size ?? 0 })).slice(0, 5000) };
    },
    async file(token, owner, repo, path, ref) {
      const q = ref ? `?ref=${encodeURIComponent(ref)}` : "";
      const data = z.object({ type: z.string(), path: z.string(), size: z.number(), sha: z.string(), content: z.string().optional(), encoding: z.string().optional() }).passthrough()
        .parse(JSON.parse(await readOnly(fetchImpl, `${apiBase()}/repos/${owner}/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}${q}`, token, "application/vnd.github+json", 3_000_000)));
      if (data.type !== "file" || data.encoding !== "base64" || data.content === undefined) throw new ConnectorError(415, "NOT_A_TEXT_FILE");
      const bytes = Buffer.from(data.content, "base64");
      if (bytes.includes(0)) throw new ConnectorError(415, "BINARY_FILE");
      return { path: data.path, size: data.size, sha: data.sha, content: bytes.toString("utf8") };
    },
  };
}
