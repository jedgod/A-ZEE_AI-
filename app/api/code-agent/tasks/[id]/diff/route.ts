import { codeAgentRoute, ok } from "@/lib/code-agent/route";
import { diffOf } from "@/lib/code-agent/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

/** GET /api/code-agent/tasks/:id/diff: unified diffs, totals, risk warnings and the patch hash to approve. */
export function GET(request: Request, { params }: P) {
  return codeAgentRoute(request, false, async ({ owner }) => ok(await diffOf(owner, (await params).id)));
}
