import { z } from "zod";
import { readJson } from "@/lib/http";
import { accountById } from "@/lib/accounts";
import { checkout, setCancelAtPeriodEnd } from "@/lib/payments/checkout";
import { paymentsConfigured } from "@/lib/payments/stripe";
import { currentSubscription, listPlans, regionFrom, subscribe } from "@/lib/plans";
import { supportTenantId } from "@/lib/staff/auth";
import { createComplaint } from "@/lib/support/complaints";
import { NO_STORE } from "@/lib/staff/route";
import { requireUser, userFailure } from "@/lib/users/auth";
import { userRoute } from "@/lib/users/route";

export const runtime = "nodejs";

const body = z.object({
  planId: z.string().regex(/^[a-z0-9-]{1,40}$/),
  billing: z.enum(["monthly", "annual"]).default("monthly"),
  expectedPrice: z.number().nonnegative().optional(),
}).strict();

/** The signed-in user's current and pending subscription (renewal date, cancel-at-period-end). */
export const GET = (request: Request) => userRoute(request, false, user => currentSubscription(user.id));

/** PATCH { cancelAtPeriodEnd: boolean }: stop (or resume) renewal. The plan stays until the period ends. */
export const PATCH = (request: Request) => userRoute(request, true, async user => {
  const { cancelAtPeriodEnd } = z.object({ cancelAtPeriodEnd: z.boolean() }).strict().parse(await readJson(request, 500));
  await setCancelAtPeriodEnd(user.id, cancelAtPeriodEnd);
  return currentSubscription(user.id);
});

/**
 * Choose a plan. Free activates at once and Enterprise goes to sales. A paid plan charges the
 * user's default saved payment method when payments are connected (Stripe); otherwise it is
 * reserved until an operator activates it, as before.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request, true);
    const input = body.parse(await readJson(request, 1_000));
    const account = await accountById(user.id);
    if (!account) return Response.json({ error: "NO_ACCOUNT" }, { status: 404, headers: NO_STORE });

    const plan = (await listPlans(regionFrom(request.headers, null))).find(p => p.id === input.planId);
    const paid = Boolean(plan && plan.price !== null && plan.price > 0);
    if (paid && paymentsConfigured()) {
      const result = await checkout(user, input, request.headers);
      const status = result.status === "active" ? 200 : result.status === "processing" ? 202
        : result.status === "price_changed" ? 409 : 402;
      return Response.json({ data: result }, { status, headers: NO_STORE });
    }

    const result = await subscribe(user.id, input.planId, input.billing, regionFrom(request.headers, account.region));
    // Enterprise: hand the request to the support team's queue so someone follows up.
    if (result.status === "contact_sales") {
      const tenantId = await supportTenantId();
      const ticket = tenantId ? await createComplaint({
        tenantId, source: "app", category: "support", reporterRef: null, customerName: account.name, customerContact: account.email,
        subject: "Enterprise plan inquiry", body: `${account.name} <${account.email}> asked about the Enterprise plan.`, priority: "medium",
      }) : null;
      return Response.json({ data: { ...result, ticket: ticket?.display ?? null } }, { status: 202, headers: NO_STORE });
    }
    return Response.json({ data: result }, { status: result.status === "active" ? 200 : 202, headers: NO_STORE });
  } catch (error) {
    if ((error as Error).message === "UNKNOWN_PLAN") return Response.json({ error: "UNKNOWN_PLAN" }, { status: 404, headers: NO_STORE });
    return userFailure(error);
  }
}
