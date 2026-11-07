import { endpoint, json } from "@/lib/admin/errors";
import { rateLimit, readBody, requireActor, sameOrigin } from "@/lib/admin/security";
import { addTag, removeTag } from "@/lib/admin/user-tools";

export const runtime = "nodejs";

export function POST(request: Request) {
  return endpoint(async () => {
    sameOrigin(request);
    const actor = await requireActor();
    await rateLimit(actor, true);
    return json({ tag: await addTag(actor, await readBody(request)) }, 201);
  });
}

export function DELETE(request: Request) {
  return endpoint(async () => {
    sameOrigin(request);
    const actor = await requireActor();
    await rateLimit(actor, true);
    const q = new URL(request.url).searchParams;
    await removeTag(actor, q.get("userId"), q.get("tagId"));
    return json({ ok: true });
  });
}
