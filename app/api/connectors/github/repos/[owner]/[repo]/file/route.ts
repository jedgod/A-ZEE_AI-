import { z } from "zod";
import { githubProvider } from "@/lib/connectors/github";
import { withToken } from "@/lib/connectors/service";
import { connectorRoute, NO_STORE } from "@/lib/connectors/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const name = z.string().regex(/^[\w.-]{1,100}$/);
const filePath = z.string().min(1).max(500).refine(p => !p.split("/").some(s => s === ".." || s === "." || s === ""), "invalid path");

/** GET /api/connectors/github/repos/:owner/:repo/file?path=[&ref=]: one text file. */
export function GET(request: Request, context: { params: Promise<{ owner: string; repo: string }> }) {
  return connectorRoute(request, false, async owner => {
    const p = await context.params;
    const [o, r] = [name.parse(p.owner), name.parse(p.repo)];
    const q = new URL(request.url).searchParams;
    const path = filePath.parse(q.get("path") ?? "");
    const gh = githubProvider();
    return Response.json({ data: await withToken(owner, "github", "repo.file", `${o}/${r}/${path}`, token => gh.file(token, o, r, path, q.get("ref") || undefined)) }, { headers: NO_STORE });
  });
}
