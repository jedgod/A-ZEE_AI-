import { handle, NO_STORE, sidebarOwner } from "@/lib/sidebar-route";
import { deleteScan } from "@/lib/vision/scans";

export const runtime = "nodejs";

/** DELETE /api/vision/scans/:id -> { data: { deleted: true } }. Only the owner can delete a scan. */
export function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const owner = await sidebarOwner(request, true);
    if (!await deleteScan(owner, (await context.params).id)) return Response.json({ error: "NOT_FOUND" }, { status: 404, headers: NO_STORE });
    return Response.json({ data: { deleted: true } }, { headers: NO_STORE });
  });
}
