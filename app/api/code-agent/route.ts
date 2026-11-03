import { codeAgentRoute, ok } from "@/lib/code-agent/route";
import { status } from "@/lib/code-agent/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/code-agent: feature, workspace and execution readiness (repository names only). */
export function GET(request: Request) {
  return codeAgentRoute(request, false, async () => ok(status()));
}
