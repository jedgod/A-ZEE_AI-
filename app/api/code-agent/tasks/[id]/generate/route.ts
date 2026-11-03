import { codeAgentRoute, ok } from "@/lib/code-agent/route";
import { generate } from "@/lib/code-agent/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

/** POST /api/code-agent/tasks/:id/generate: a stored, reviewed patch; files are not modified. */
export function POST(request: Request, { params }: P) {
  return codeAgentRoute(request, true, async ({ owner, actor }) => ok(await generate(owner, (await params).id, actor)));
}
