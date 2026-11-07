import { endpoint, json } from "@/lib/admin/errors";
import { rateLimit, readBody, requireActor, sameOrigin } from "@/lib/admin/security";
import { deleteView, listViews, saveView } from "@/lib/admin/user-tools";

export const runtime = "nodejs";

export function GET() {
  return endpoint(async () => {
    const actor = await requireActor();
    await rateLimit(actor, false);
    return json({ views: await listViews(actor) });
  });
}

export function POST(request: Request) {
  return endpoint(async () => {
    sameOrigin(request);
    const actor = await requireActor();
    await rateLimit(actor, true);
    return json({ view: await saveView(actor, await readBody(request)) }, 201);
  });
}

export function DELETE(request: Request) {
  return endpoint(async () => {
    sameOrigin(request);
    const actor = await requireActor();
    await rateLimit(actor, true);
    await deleteView(actor, new URL(request.url).searchParams.get("id"));
    return json({ ok: true });
  });
}
