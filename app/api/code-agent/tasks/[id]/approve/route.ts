import { codeAgentRoute, ok } from "@/lib/code-agent/route";
import { body } from "@/lib/sidebar-route";
import { approve } from "@/lib/code-agent/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

/** POST /api/code-agent/tasks/:id/approve { patchHash, acknowledgeRisks? } */
export function POST(request: Request, { params }: P) {
  return codeAgentRoute(request, true, async ({ owner }) => ok(await approve(owner, (await params).id, await body(request, 4_000))));
}
