import "server-only";
import { z } from "zod";
import { chatError } from "@/lib/chat/web";
import type { RequestActor } from "@/lib/pipeline/actor";
import { accessFor } from "@/lib/plans";
import { actorFor } from "@/lib/users/auth";
import { SidebarError } from "@/lib/sidebar";
import { NO_STORE, sidebarOwner } from "@/lib/sidebar-route";
import { CodeAgentError } from "./paths";

// Shared by /api/code-agent/*: this machine's signed-in account (same rule as the sidebar). Changes
// must be same-origin and carry the X-AZee-Request header, which a cross-site form or a simple
// cross-origin request can't send.

export const CSRF_HEADER = "x-azee-request";

export async function codeAgentRoute(request: Request, mutation: boolean, work: (ctx: { owner: string; actor: RequestActor }) => Promise<Response>) {
  const reply = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: NO_STORE });
  try {
    if (mutation && request.headers.get(CSRF_HEADER) !== "1") return reply(403, { error: "CSRF_HEADER_REQUIRED" });
    const owner = await sidebarOwner(request, mutation);
    const { actor } = await actorFor(request);
    // The code agent writes detailed, multi-file changes, which the Free plan doesn't include
    // (free coding answers are basic and short; see lib/pipeline/free-limits.ts).
    if (process.env.DATABASE_URL && (await accessFor(actor)).planId === "free") return reply(403, { error: "UPGRADE_REQUIRED", feature: "code_agent" });
    return await work({ owner, actor });
  } catch (error) {
    if (error instanceof CodeAgentError) return reply(error.status, { error: error.code, ...(error.detail !== undefined ? { detail: error.detail } : {}) });
    if (error instanceof SidebarError) return reply(error.status, { error: error.code });
    if (error instanceof z.ZodError) return reply(422, { error: "INVALID_INPUT", issues: error.issues.slice(0, 5).map(i => `${i.path.join(".") || "body"}: ${i.message}`) });
    if (error instanceof SyntaxError) return reply(422, { error: "INVALID_JSON" });
    const mapped = chatError(error);
    if (mapped.status === 503 && mapped.body.error === "SERVICE_UNAVAILABLE") console.warn("code agent API failed:", (error as Error)?.message?.slice(0, 200));
    return reply(mapped.status, mapped.body);
  }
}

export const ok = (data: unknown, status = 200) => Response.json({ data }, { status, headers: NO_STORE });
