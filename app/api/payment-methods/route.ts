import { listMethods, finishSetup } from "@/lib/payments/methods";
import { jsonBody, userRoute } from "@/lib/users/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET: the signed-in user's saved methods (brand, last four, expiry only). POST { setupIntentId }: finish a setup Stripe completed and save the method. */
export const GET = (request: Request) => userRoute(request, false, user => listMethods(user.id));
export const POST = (request: Request) => userRoute(request, true, async user => finishSetup(user, await jsonBody(request, 2_000)), 201);
