import { addPrompt, deletePrompt, listPrompts } from "@/lib/users/features";
import { jsonBody, userRoute } from "@/lib/users/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The signed-in user's prompt library. POST { title, content }; DELETE ?id=. */
export const GET = (request: Request) => userRoute(request, false, user => listPrompts(user.id));
export const POST = (request: Request) => userRoute(request, true, async user => addPrompt(user.id, await jsonBody(request)), 201);
export const DELETE = (request: Request) => userRoute(request, true, async user => { await deletePrompt(user.id, new URL(request.url).searchParams.get("id")); return { ok: true }; });
