import { codeAgentRoute, ok } from "@/lib/code-agent/route";
import { auditOf } from "@/lib/code-agent/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

/** GET /api/code-agent/tasks/:id/audit */
export function GET(request: Request, { params }: P) {
  return codeAgentRoute(request, false, async ({ owner }) => ok(await auditOf(owner, (await params).id)));
}
