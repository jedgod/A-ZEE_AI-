import { handle, NO_STORE, sidebarOwner } from "@/lib/sidebar-route";
import { allow } from "@/lib/users/auth";
import { acceptUpload, MAX_VIDEO_BYTES, UploadError } from "@/lib/video-upload";
import { ollamaOnly } from "@/lib/pipeline/privacy";

export const runtime = "nodejs";

/**
 * POST /api/vision/upload-video (multipart, field "file"; MP4, MOV or WebM up to 50 MB) -> { data: { videoUrl, fileName } }.
 * Hosts the clip temporarily as the source for an Edit Video job; it is deleted when the job finishes. Refused in
 * ollama-only privacy mode, for signed-out requests, and when cloud storage (UPLOADTHING_TOKEN) is not set up.
 */
export function POST(request: Request) {
  return handle(async () => {
    if (ollamaOnly()) return Response.json({ error: "EXTERNAL_DATA_DISABLED" }, { status: 403, headers: NO_STORE });
    const owner = await sidebarOwner(request, true);
    const length = Number(request.headers.get("content-length"));
    if (Number.isFinite(length) && length > MAX_VIDEO_BYTES + 200_000) return Response.json({ error: "VIDEO_TOO_LARGE" }, { status: 413, headers: NO_STORE });
    if (!await allow("video-upload", owner, 5)) return Response.json({ error: "RATE_LIMITED" }, { status: 429, headers: { ...NO_STORE, "Retry-After": "60" } });
    let file: FormDataEntryValue | null;
    try { file = (await request.formData()).get("file"); } catch { return Response.json({ error: "INVALID_UPLOAD" }, { status: 400, headers: NO_STORE }); }
    if (!(file instanceof File)) return Response.json({ error: "NO_FILE" }, { status: 400, headers: NO_STORE });
    try {
      return Response.json({ data: await acceptUpload(owner, file) }, { status: 201, headers: NO_STORE });
    } catch (error) {
      if (error instanceof UploadError) return Response.json({ error: error.code }, { status: error.status, headers: NO_STORE });
      throw error;
    }
  });
}
