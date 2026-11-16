import { open } from "node:fs/promises";
import { join } from "node:path";
import { handle, NO_STORE, sidebarOwner } from "@/lib/sidebar-route";
import { comparisonIsAllowed } from "@/lib/vision/matches";
import { getScan } from "@/lib/vision/scans";

export const runtime = "nodejs";
const MAX_BYTES = 512_000;
const missing = () => Response.json({ error: "COMPARISON_NOT_FOUND" }, { status: 404, headers: NO_STORE });

export function GET(request: Request, context: { params: Promise<{ id: string; source: string }> }) {
  return handle(async () => {
    const owner = await sidebarOwner(request);
    const { id, source } = await context.params;
    const dir = process.env.AZ_IMAGE_PREVIEW_DIR;
    if (!dir || !/^[a-f0-9]{64}$/.test(source)) return missing();
    const scan = await getScan(owner, id);
    if (!await comparisonIsAllowed(source, scan?.verification?.publicIndex?.matches ?? [])) return missing();
    const file = await open(join(dir, `${source}.jpg`), "r").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!file) return missing();
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size < 3 || info.size > MAX_BYTES) return missing();
      const bytes = new Uint8Array(info.size + 1);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      if (offset !== info.size || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) return missing();
      return new Response(bytes.subarray(0, offset), {
        headers: { ...NO_STORE, "Content-Type": "image/jpeg", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin" },
      });
    } finally { await file.close(); }
  });
}
