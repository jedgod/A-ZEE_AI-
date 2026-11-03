import { codeAgentRoute, ok } from "@/lib/code-agent/route";
import { inspectGit } from "@/lib/code-agent/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type P = { params: Promise<{ repo: string }> };

/** GET /api/code-agent/repos/:repo/git: branch and working-tree status (null when not a git repository). */
export function GET(request: Request, { params }: P) {
  return codeAgentRoute(request, false, async ({ owner }) => ok(await inspectGit(owner, (await params).repo)));
}
