import { chatAllowed } from "@/lib/chat/web";
import { handle, NO_STORE, sidebarOwner } from "@/lib/sidebar-route";
import { detectImage, MAX_IMAGE_BYTES } from "@/lib/vision/detect";
import { saveScan } from "@/lib/vision/scans";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = MAX_IMAGE_BYTES + 100_000;
const FILE_ERRORS: Record<string, number> = { EMPTY_FILE: 422, FILE_TOO_LARGE: 413, UNSUPPORTED_FORMAT: 415, INVALID_IMAGE: 422 };

/** POST multipart field "file". Stores verification results for the account. */
export function POST(request: Request) {
  return handle(async () => {
    const owner = await sidebarOwner(request, true);
    const length = Number(request.headers.get("content-length"));
    if (Number.isFinite(length) && length > MAX_UPLOAD_BYTES) return Response.json({ error: "FILE_TOO_LARGE" }, { status: 413, headers: NO_STORE });
    if (!await chatAllowed(request)) return Response.json({ error: "RATE_LIMITED" }, { status: 429, headers: { ...NO_STORE, "Retry-After": "60" } });
    const type = request.headers.get("content-type");
    if (!type || !/^multipart\/form-data\s*;/i.test(type) || !request.body) {
      return Response.json({ error: "INVALID_UPLOAD" }, { status: 400, headers: NO_STORE });
    }
    const reader = request.body.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let size = 0;
    let file: FormDataEntryValue | null;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_UPLOAD_BYTES) {
          void reader.cancel().catch(() => undefined);
          return Response.json({ error: "FILE_TOO_LARGE" }, { status: 413, headers: NO_STORE });
        }
        chunks.push(new Uint8Array(value));
      }
      file = (await new Response(new Blob(chunks), { headers: { "Content-Type": type } }).formData()).get("file");
    } catch {
      return Response.json({ error: "INVALID_UPLOAD" }, { status: 400, headers: NO_STORE });
    } finally { reader.releaseLock(); }
    if (!(file instanceof File)) return Response.json({ error: "NO_FILE" }, { status: 400, headers: NO_STORE });
    if (file.size > MAX_IMAGE_BYTES) return Response.json({ error: "FILE_TOO_LARGE" }, { status: 413, headers: NO_STORE });
    try {
      const detection = await detectImage(new Uint8Array(await file.arrayBuffer()));
      return Response.json({ data: await saveScan(owner, detection) }, { headers: NO_STORE });
    } catch (error) {
      const status = FILE_ERRORS[(error as Error).message];
      if (status) return Response.json({ error: (error as Error).message }, { status, headers: NO_STORE });
      throw error;
    }
  });
}
