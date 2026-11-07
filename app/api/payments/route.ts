import { listPayments } from "@/lib/payments/checkout";
import { userRoute } from "@/lib/users/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET: the signed-in user's payment history (amount, plan, status; never card or provider details). */
export const GET = (request: Request) => userRoute(request, false, user => listPayments(user.id));
