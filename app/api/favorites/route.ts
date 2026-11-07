import { addFavorite, listFavorites, removeFavorite } from "@/lib/users/features";
import { jsonBody, userRoute } from "@/lib/users/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET: this user's favorite chats. POST { chatId }: add one of your own chats. DELETE ?chatId=: remove. */
export const GET = (request: Request) => userRoute(request, false, user => listFavorites(user.id));
export const POST = (request: Request) => userRoute(request, true, async user => { await addFavorite(user.id, await jsonBody(request)); return { ok: true }; }, 201);
export const DELETE = (request: Request) => userRoute(request, true, async user => { await removeFavorite(user.id, new URL(request.url).searchParams.get("chatId")); return { ok: true }; });
