import { localAccount } from "@/lib/accounts";
import { accessFor, currentSubscription, listPlans, regionFrom, usageFor } from "@/lib/plans";
import { hasRegionalDiscount } from "@/lib/pricing";
import { webActor } from "@/lib/pipeline/actor";
import { errorResponse, NO_STORE } from "@/lib/staff/route";

export const runtime = "nodejs";

/** Plans with regional prices, plus this visitor's current plan and this month's usage. */
export async function GET(request: Request) {
  try {
    const { actor } = webActor(request);
    const account = actor.local ? await localAccount() : null;
    const region = regionFrom(request.headers, account?.region ?? null);
    const [plans, access] = await Promise.all([listPlans(region), accessFor(actor)]);
    const limits = Object.fromEntries(Object.entries(access.entitlements).filter(([, g]) => g.enabled).map(([f, g]) => [f, g.monthlyLimit]));
    return Response.json({
      data: {
        region, regionalDiscount: hasRegionalDiscount(region), plans,
        current: { planId: access.planId, subscription: actor.local ? await currentSubscription() : null, usage: await usageFor(access.subject), limits },
        canSubscribe: actor.local && Boolean(account),
      },
    }, { headers: NO_STORE });
  } catch (error) { return errorResponse(error); }
}
