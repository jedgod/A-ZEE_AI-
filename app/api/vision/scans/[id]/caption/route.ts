import { z } from "zod";
import { chatAllowed } from "@/lib/chat/web";
import { body, handle, NO_STORE, sidebarOwner } from "@/lib/sidebar-route";
import { checkCaption } from "@/lib/vision/caption";
import { getCaption, getScan, saveCaption } from "@/lib/vision/scans";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
const schema = z.object({ caption: z.string().trim().min(1).max(1000).refine(value => !value.includes("\0")) }).strict();
const missing = () => Response.json({ error: "SCAN_NOT_FOUND" }, { status: 404, headers: NO_STORE });

export function GET(request: Request, context: Context) {
  return handle(async () => {
    const owner = await sidebarOwner(request);
    const row = await getCaption(owner, (await context.params).id);
    return row ? Response.json({ data: row.result ? row : null }, { headers: NO_STORE }) : missing();
  });
}

export function POST(request: Request, context: Context) {
  return handle(async () => {
    const owner = await sidebarOwner(request, true);
    if (!await chatAllowed(request)) return Response.json({ error: "RATE_LIMITED" }, { status: 429, headers: { ...NO_STORE, "Retry-After": "60" } });
    const { id } = await context.params;
    const { caption } = schema.parse(await body(request, 8192));
    const scan = await getScan(owner, id);
    if (!scan) return missing();
    const row = await saveCaption(owner, id, caption, checkCaption(caption, scan.verification?.publicIndex?.matches ?? []));
    return row ? Response.json({ data: row }, { headers: NO_STORE }) : missing();
  });
}
