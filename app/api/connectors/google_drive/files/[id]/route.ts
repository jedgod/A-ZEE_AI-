import { googleDriveProvider } from "@/lib/connectors/google-drive";
import { withToken } from "@/lib/connectors/service";
import { connectorRoute, NO_STORE } from "@/lib/connectors/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/connectors/google-drive/files/:id: a document's text (Google Docs exported as text). */
export function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return connectorRoute(request, false, async owner => {
    const { id } = await context.params;
    const drive = googleDriveProvider();
    return Response.json({ data: await withToken(owner, "google_drive", "file.read", id, token => drive.fileText(token, id)) }, { headers: NO_STORE });
  });
}
