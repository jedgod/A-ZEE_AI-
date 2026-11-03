import { codeAgentRoute, ok } from "@/lib/code-agent/route";
import { plan } from "@/lib/code-agent/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

/** POST /api/code-agent/tasks/:id/plan: affected files, steps and expected tests (nothing is changed). */
export function POST(request: Request, { params }: P) {
  return codeAgentRoute(request, true, async ({ owner, actor }) => ok(await plan(owner, (await params).id, actor)));
}
