import { codeAgentRoute, ok } from "@/lib/code-agent/route";
import { body } from "@/lib/sidebar-route";
import { createTask, listTasks } from "@/lib/code-agent/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/code-agent/tasks: this account's tasks (history). */
export function GET(request: Request) {
  return codeAgentRoute(request, false, async ({ owner }) => ok(await listTasks(owner)));
}

/** POST /api/code-agent/tasks { repo, instruction }. */
export function POST(request: Request) {
  return codeAgentRoute(request, true, async ({ owner }) => ok(await createTask(owner, await body(request, 16_000)), 201));
}
