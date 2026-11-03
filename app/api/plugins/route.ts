import { listPlugins } from "@/lib/plugins/service";
import { NO_STORE, sidebarOwner } from "@/lib/sidebar-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/plugins -> { data: Plugin[] }: connectors for the signed-in local account plus the workspace's skills. */
export async function GET(request: Request) {
  try {
    const owner = await sidebarOwner(request).catch(() => null);
    return Response.json({ data: await listPlugins(owner) }, { headers: NO_STORE });
  } catch (error) {
    console.warn("plugins list failed:", (error as Error)?.message?.slice(0, 200));
    return Response.json({ error: "SERVICE_UNAVAILABLE" }, { status: 503, headers: NO_STORE });
  }
}
