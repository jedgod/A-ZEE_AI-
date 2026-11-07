import { endpoint, json } from "@/lib/admin/errors";
import { rateLimit, readBody, requireActor, sameOrigin } from "@/lib/admin/security";
import { addNote, deleteNote, listNotes } from "@/lib/admin/user-tools";

export const runtime = "nodejs";

export function GET(request: Request) {
  return endpoint(async () => {
    const actor = await requireActor();
    await rateLimit(actor, false);
    return json({ notes: await listNotes(actor, new URL(request.url).searchParams.get("userId")) });
  });
}

export function POST(request: Request) {
  return endpoint(async () => {
    sameOrigin(request);
    const actor = await requireActor();
    await rateLimit(actor, true);
    return json({ id: await addNote(actor, await readBody(request)) }, 201);
  });
}

export function DELETE(request: Request) {
  return endpoint(async () => {
    sameOrigin(request);
    const actor = await requireActor();
    await rateLimit(actor, true);
    await deleteNote(actor, new URL(request.url).searchParams.get("id"));
    return json({ ok: true });
  });
}
