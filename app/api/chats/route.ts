import { handle, NO_STORE, sidebarOwner } from "@/lib/sidebar-route";
import { listChats } from "@/lib/sidebar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/chats[?projectId=<uuid|general>][&limit=n]: all of this account's chats (pinned first, then newest). */
export function GET(request: Request) {
  return handle(async () => {
    const owner = await sidebarOwner(request);
    const params = new URL(request.url).searchParams;
    const limit = params.get("limit");
    return Response.json({ data: await listChats(owner, { projectId: params.get("projectId"), ...(limit ? { limit: Number(limit) || 200 } : {}) }) }, { headers: NO_STORE });
  });
}
