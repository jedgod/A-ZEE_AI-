import { searchChats } from "@/lib/users/features";
import { userRoute } from "@/lib/users/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET ?q=: search the signed-in user's own chat titles. */
export const GET = (request: Request) => userRoute(request, false, user => searchChats(user.id, new URL(request.url).searchParams.get("q")));
