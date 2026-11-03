import { codeAgentRoute, ok } from "@/lib/code-agent/route";
import { inspectFile } from "@/lib/code-agent/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type P = { params: Promise<{ repo: string }> };

/** GET /api/code-agent/repos/:repo/file?path=: one text file (sensitive paths and symlinks refused). */
export function GET(request: Request, { params }: P) {
  return codeAgentRoute(request, false, async ({ owner }) => ok(await inspectFile(owner, (await params).repo, new URL(request.url).searchParams.get("path") ?? "")));
}
