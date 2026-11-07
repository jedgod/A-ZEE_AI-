import "server-only";
import { z } from "zod";
import { chatError } from "@/lib/chat/web";
import type { RequestActor } from "@/lib/pipeline/actor";
import { actorFor } from "@/lib/users/auth";
import { ResearchError } from "@/lib/research/jobs";
import { SidebarError } from "@/lib/sidebar";
import { NO_STORE, sidebarOwner } from "@/lib/sidebar-route";
import { SearchNotConfiguredError, SearchUnavailableError } from "./tavily";

// Shared by /api/v1/search/* and /api/v1/research/*: this machine's signed-in account (same rule
// as the sidebar), same-origin for POSTs, and one error mapping.

export async function searchRoute(request: Request, mutation: boolean, work: (ctx: { owner: string; actor: RequestActor }) => Promise<Response>) {
  try {
    const owner = await sidebarOwner(request, mutation);
    return await work({ owner, actor: (await actorFor(request)).actor });
  } catch (error) {
    const reply = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: NO_STORE });
    if (error instanceof SearchNotConfiguredError) {
      return reply(503, { error: "SEARCH_NOT_CONFIGURED", setup: "Add TAVILY_API_KEY to .env.local (https://tavily.com) and restart the server." });
    }
    if (error instanceof SearchUnavailableError) return reply(502, { error: "SEARCH_UNAVAILABLE", ...(error.status ? { providerStatus: error.status } : {}) });
    if (error instanceof ResearchError || error instanceof SidebarError) return reply(error.status, { error: error.code });
    if (error instanceof z.ZodError) return reply(422, { error: "INVALID_INPUT", issues: error.issues.slice(0, 5).map(i => `${i.path.join(".") || "body"}: ${i.message}`) });
    if (error instanceof SyntaxError) return reply(422, { error: "INVALID_JSON" });
    if (error instanceof Response) return error;
    const mapped = chatError(error);
    if (mapped.status === 503 && mapped.body.error === "SERVICE_UNAVAILABLE") console.warn("search API failed:", (error as Error)?.message?.slice(0, 200));
    return reply(mapped.status, mapped.body);
  }
}

export { NO_STORE };
