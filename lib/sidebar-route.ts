import "server-only";
import { z } from "zod";
import { readJson } from "@/lib/http";
import { sessionUser, strictOrigin } from "@/lib/users/auth";
import { UserError } from "@/lib/users/types";
import { SidebarError } from "@/lib/sidebar";

// Shared by /api/sidebar, /api/projects and /api/chats.

export const NO_STORE = { "Cache-Control": "no-store" };

/**
 * The signed-in account that owns the sidebar. Guests get 401 and the browser keeps its
 * local-only sidebar. Writes also need a same-origin request.
 */
export async function sidebarOwner(request: Request, mutation = false): Promise<string> {
  if (!process.env.DATABASE_URL) throw new SidebarError(503, "SIDEBAR_UNAVAILABLE");
  if (mutation) {
    try { strictOrigin(request); } catch (error) { if (error instanceof UserError) throw new SidebarError(error.status, error.code); throw error; }
  }
  const user = await sessionUser(request);
  if (!user) throw new SidebarError(401, "SIGN_IN_REQUIRED");
  return user.id;
}

/** JSON body; chats with messages need more room than metadata (default 64 KB). */
export const body = (request: Request, limit = 64_000) => readJson(request, limit);

export async function handle(work: () => Promise<Response>): Promise<Response> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof SidebarError) return Response.json({ error: error.code }, { status: error.status, headers: NO_STORE });
    if (error instanceof z.ZodError) return Response.json({ error: "INVALID_INPUT", issues: error.issues.slice(0, 5).map(i => `${i.path.join(".") || "body"}: ${i.message}`) }, { status: 422, headers: NO_STORE });
    if (error instanceof SyntaxError) return Response.json({ error: "INVALID_JSON" }, { status: 422, headers: NO_STORE });
    if (error instanceof Response) return error;
    console.warn("sidebar API failed:", (error as Error)?.message?.slice(0, 200));
    return Response.json({ error: "SERVICE_UNAVAILABLE" }, { status: 503, headers: NO_STORE });
  }
}
