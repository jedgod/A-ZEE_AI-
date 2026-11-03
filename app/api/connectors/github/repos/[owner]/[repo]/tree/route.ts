import { z } from "zod";
import { githubProvider } from "@/lib/connectors/github";
import { withToken } from "@/lib/connectors/service";
import { connectorRoute, NO_STORE } from "@/lib/connectors/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const name = z.string().regex(/^[\w.-]{1,100}$/);

/** GET /api/connectors/github/repos/:owner/:repo/tree[?ref=]: the repository's file list. */
export function GET(request: Request, context: { params: Promise<{ owner: string; repo: string }> }) {
  return connectorRoute(request, false, async owner => {
    const p = await context.params;
    const [o, r] = [name.parse(p.owner), name.parse(p.repo)];
    const ref = new URL(request.url).searchParams.get("ref") || undefined;
    const gh = githubProvider();
    return Response.json({ data: await withToken(owner, "github", "repo.tree", `${o}/${r}`, token => gh.tree(token, o, r, ref)) }, { headers: NO_STORE });
  });
}
