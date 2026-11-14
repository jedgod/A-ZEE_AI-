import { chatAllowed } from "@/lib/chat/web";
import { handle, NO_STORE, sidebarOwner } from "@/lib/sidebar-route";
import { detectImage, MAX_IMAGE_BYTES } from "@/lib/vision/detect";
import { saveScan } from "@/lib/vision/scans";

export const runtime = "nodejs";

const FILE_ERRORS: Record<string, number> = { EMPTY_FILE: 422, FILE_TOO_LARGE: 413, UNSUPPORTED_FORMAT: 415 };

/**
 * POST /api/vision/detect-ai (multipart, field "file") -> { data: scan }. Checks an image for signs of AI
 * generation using its metadata (and an outside pixel classifier only if configured and allowed) and saves
 * the result to the signed-in account. The image is not stored. Shares the chat rate limit.
 */
export function POST(request: Request) {
  return handle(async () => {
    const owner = await sidebarOwner(request, true);
    const length = Number(request.headers.get("content-length"));
    if (Number.isFinite(length) && length > MAX_IMAGE_BYTES + 100_000) return Response.json({ error: "FILE_TOO_LARGE" }, { status: 413, headers: NO_STORE });
    if (!await chatAllowed(request)) return Response.json({ error: "RATE_LIMITED" }, { status: 429, headers: { ...NO_STORE, "Retry-After": "60" } });
    let file: FormDataEntryValue | null;
    try { file = (await request.formData()).get("file"); } catch { return Response.json({ error: "INVALID_UPLOAD" }, { status: 400, headers: NO_STORE }); }
    if (!(file instanceof File)) return Response.json({ error: "NO_FILE" }, { status: 400, headers: NO_STORE });
    try {
      const detection = await detectImage(new Uint8Array(await file.arrayBuffer()), file.name, file.type);
      return Response.json({ data: await saveScan(owner, detection) }, { headers: NO_STORE });
    } catch (error) {
      const status = FILE_ERRORS[(error as Error).message];
      if (status) return Response.json({ error: (error as Error).message }, { status, headers: NO_STORE });
      throw error;
    }
  });
}
