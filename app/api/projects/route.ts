import { z } from "zod";
import { body, handle, NO_STORE, sidebarOwner } from "@/lib/sidebar-route";
import { createProject, listProjects } from "@/lib/sidebar";

export const runtime = "nodejs";

/** GET /api/projects: all of this account's projects (General is implicit). */
export function GET(request: Request) {
  return handle(async () => Response.json({ data: await listProjects(await sidebarOwner(request)) }, { headers: NO_STORE }));
}

/**
 * POST /api/projects { name, id? }: 201 when created, 200 when a project with that name already
 * exists (its id is returned). `id` lets the browser create the project optimistically.
 */
export function POST(request: Request) {
  return handle(async () => {
    const owner = await sidebarOwner(request, true);
    const { name, id } = z.object({ name: z.string().max(200), id: z.string().uuid().optional() }).strict().parse(await body(request));
    const { project, created } = await createProject(owner, name, id);
    return Response.json({ data: project }, { status: created ? 201 : 200, headers: NO_STORE });
  });
}
