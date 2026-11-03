import { googleDriveProvider } from "@/lib/connectors/google-drive";
import { withToken } from "@/lib/connectors/service";
import { connectorRoute, NO_STORE } from "@/lib/connectors/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/connectors/google-drive/files[?q=&pageToken=]: files the account can read (newest first). */
export function GET(request: Request) {
  return connectorRoute(request, false, async owner => {
    const q = new URL(request.url).searchParams;
    const drive = googleDriveProvider();
    return Response.json({ data: await withToken(owner, "google_drive", "files.list", q.get("q"), token => drive.listFiles(token, q.get("q") ?? undefined, q.get("pageToken") ?? undefined)) }, { headers: NO_STORE });
  });
}
