import { handle, NO_STORE, sidebarOwner } from "@/lib/sidebar-route";
import { sidebarFor } from "@/lib/sidebar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/sidebar[?project=<uuid|general>][&chats=all][&projects=all]
 * Groups and items from sidebar_groups/sidebar_items (enabled only), with this account's
 * projects (8, or all) and chats (pinned first; 8, or all; optionally one project's).
 */
export function GET(request: Request) {
  return handle(async () => {
    const owner = await sidebarOwner(request);
    const params = new URL(request.url).searchParams;
    const groups = await sidebarFor(owner, {
      project: params.get("project"),
      allChats: params.get("chats") === "all",
      allProjects: params.get("projects") === "all",
    });
    return Response.json({ data: groups }, { headers: NO_STORE });
  });
}
