import { startSetup } from "@/lib/payments/methods";
import { jsonBody, userRoute } from "@/lib/users/route";

export const runtime = "nodejs";

/** POST { kind: "card" | "bank_account" }: a one-time client secret for Stripe's secure form. */
export const POST = (request: Request) => userRoute(request, true, async user => startSetup(user, await jsonBody(request, 1_000)));
