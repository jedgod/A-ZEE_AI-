import { unreadCount } from "@/lib/users/features";
import { userRoute } from "@/lib/users/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET: the unread badge for the Bell. Guests get 401, which the rail treats as zero. */
export const GET = (request: Request) => userRoute(request, false, async user => ({ count: await unreadCount(user.id) }));
