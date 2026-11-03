import { body, handle, NO_STORE, sidebarOwner } from "@/lib/sidebar-route";
import { importLocal } from "@/lib/sidebar";

export const runtime = "nodejs";

/** POST /api/sidebar/import: a browser's projects and chats (with messages); fills gaps, never overwrites. */
export function POST(request: Request) {
  return handle(async () => {
    const owner = await sidebarOwner(request, true);
    return Response.json({ data: await importLocal(owner, await body(request, 12_000_000)) }, { headers: NO_STORE });
  });
}
