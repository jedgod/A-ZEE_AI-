import { codeAgentRoute, ok } from "@/lib/code-agent/route";
import { getTask } from "@/lib/code-agent/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

/** GET /api/code-agent/tasks/:id */
export function GET(request: Request, { params }: P) {
  return codeAgentRoute(request, false, async ({ owner }) => ok(await getTask(owner, (await params).id)));
}
