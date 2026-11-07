import { statusFor } from "@/lib/abuse/signals";
import { userRoute } from "@/lib/users/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET: whether the free-plan upgrade wall applies to this account. It reports a yes/no and a
 * count only. Other accounts' identities are never returned to users.
 */
export const GET = (request: Request) => userRoute(request, false, user => statusFor(user.id));
