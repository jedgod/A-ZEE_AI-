import { codeAgentRoute, ok } from "@/lib/code-agent/route";
import { rollback } from "@/lib/code-agent/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

/** POST /api/code-agent/tasks/:id/rollback: restores the agent's files; refused if any was edited since. */
export function POST(request: Request, { params }: P) {
  return codeAgentRoute(request, true, async ({ owner }) => ok(await rollback(owner, (await params).id)));
}
