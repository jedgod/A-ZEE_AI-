import { handle, NO_STORE, sidebarOwner } from "@/lib/sidebar-route";
import { clearScans, listScans } from "@/lib/vision/scans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/vision/scans -> { data: { scans } }: the signed-in account's recent AI-image checks, newest first. */
export function GET(request: Request) {
  return handle(async () => {
    const owner = await sidebarOwner(request);
    return Response.json({ data: { scans: await listScans(owner) } }, { headers: NO_STORE });
  });
}

/** DELETE /api/vision/scans -> { data: { cleared } }: removes every scan the signed-in account has saved. */
export function DELETE(request: Request) {
  return handle(async () => {
    const owner = await sidebarOwner(request, true);
    return Response.json({ data: { cleared: await clearScans(owner) } }, { headers: NO_STORE });
  });
}
