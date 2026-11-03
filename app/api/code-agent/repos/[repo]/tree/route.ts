import { codeAgentRoute, ok } from "@/lib/code-agent/route";
import { inspectTree } from "@/lib/code-agent/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type P = { params: Promise<{ repo: string }> };

/** GET /api/code-agent/repos/:repo/tree: files of an authorized repository. */
export function GET(request: Request, { params }: P) {
  return codeAgentRoute(request, false, async ({ owner }) => ok(await inspectTree(owner, (await params).repo)));
}
