import { githubProvider } from "@/lib/connectors/github";
import { withToken } from "@/lib/connectors/service";
import { connectorRoute, NO_STORE } from "@/lib/connectors/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/connectors/github/repos: repositories the connected account can read. */
export function GET(request: Request) {
  return connectorRoute(request, false, async owner => {
    const gh = githubProvider();
    return Response.json({ data: await withToken(owner, "github", "repos.list", null, token => gh.listRepos(token)) }, { headers: NO_STORE });
  });
}
