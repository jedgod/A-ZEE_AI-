import { codeAgentRoute, ok } from "@/lib/code-agent/route";
import { body } from "@/lib/sidebar-route";
import { apply } from "@/lib/code-agent/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };

/** POST /api/code-agent/tasks/:id/apply { patchHash }: writes the approved patch (all files or none). */
export function POST(request: Request, { params }: P) {
  return codeAgentRoute(request, true, async ({ owner }) => ok(await apply(owner, (await params).id, await body(request, 4_000))));
}
