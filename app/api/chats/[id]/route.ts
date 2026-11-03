import { body, handle, NO_STORE, sidebarOwner } from "@/lib/sidebar-route";
import { deleteChatRecord, getChat, updateChat, upsertChat } from "@/lib/sidebar";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

// A chat: metadata (title, project, mode, pin) and its messages, owner-scoped.

/** GET /api/chats/:id: the chat with its messages. */
export function GET(request: Request, context: Context) {
  return handle(async () => {
    const owner = await sidebarOwner(request);
    return Response.json({ data: await getChat(owner, (await context.params).id) }, { headers: NO_STORE });
  });
}

/** PUT /api/chats/:id { title, projectId?, mode?, messages? }: create or update when the browser saves a chat. */
export function PUT(request: Request, context: Context) {
  return handle(async () => {
    const owner = await sidebarOwner(request, true);
    return Response.json({ data: await upsertChat(owner, (await context.params).id, await body(request, 3_500_000)) }, { headers: NO_STORE });
  });
}

/** PATCH /api/chats/:id { title?, pinned?, projectId? } */
export function PATCH(request: Request, context: Context) {
  return handle(async () => {
    const owner = await sidebarOwner(request, true);
    return Response.json({ data: await updateChat(owner, (await context.params).id, await body(request)) }, { headers: NO_STORE });
  });
}

export function DELETE(request: Request, context: Context) {
  return handle(async () => {
    const owner = await sidebarOwner(request, true);
    await deleteChatRecord(owner, (await context.params).id);
    return new Response(null, { status: 204, headers: NO_STORE });
  });
}
