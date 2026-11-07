import { makeDefault, removeMethod } from "@/lib/payments/methods";
import { userRoute } from "@/lib/users/route";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

/** PATCH: make this method the default. DELETE: remove it (it is detached at Stripe first). */
export const PATCH = (request: Request, { params }: Context) => userRoute(request, true, async user => makeDefault(user, (await params).id));
export const DELETE = (request: Request, { params }: Context) => userRoute(request, true, async user => removeMethod(user, (await params).id));
