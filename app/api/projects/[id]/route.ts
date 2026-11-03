import { body, handle, NO_STORE, sidebarOwner } from "@/lib/sidebar-route";
import { deleteProject, getProject, updateProject } from "@/lib/sidebar";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

/** GET /api/projects/:id: name, description, instructions, default mode. */
export function GET(request: Request, context: Context) {
  return handle(async () => {
    const owner = await sidebarOwner(request);
    return Response.json({ data: await getProject(owner, (await context.params).id) }, { headers: NO_STORE });
  });
}

/** PATCH /api/projects/:id { name?, description?, instructions?, defaultMode? } (Rename, Edit, Settings). */
export function PATCH(request: Request, context: Context) {
  return handle(async () => {
    const owner = await sidebarOwner(request, true);
    return Response.json({ data: await updateProject(owner, (await context.params).id, await body(request)) }, { headers: NO_STORE });
  });
}

/** DELETE /api/projects/:id: the project's chats move to General. */
export function DELETE(request: Request, context: Context) {
  return handle(async () => {
    const owner = await sidebarOwner(request, true);
    await deleteProject(owner, (await context.params).id);
    return new Response(null, { status: 204, headers: NO_STORE });
  });
}
