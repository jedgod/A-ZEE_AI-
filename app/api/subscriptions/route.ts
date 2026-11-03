import { z } from "zod";
import { readJson } from "@/lib/http";
import { localAccount } from "@/lib/accounts";
import { regionFrom, subscribe } from "@/lib/plans";
import { isLocalRequest } from "@/lib/pipeline/actor";
import { supportTenantId } from "@/lib/staff/auth";
import { createComplaint } from "@/lib/support/complaints";
import { errorResponse, NO_STORE, requireSameOrigin } from "@/lib/staff/route";

export const runtime = "nodejs";

const body = z.object({ planId: z.string().regex(/^[a-z0-9-]{1,40}$/), billing: z.enum(["monthly", "annual"]).default("monthly") }).strict();

/** Choose a plan for this machine's account. Paid plans wait for payment; Enterprise goes to sales. */
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    if (!isLocalRequest(request)) return Response.json({ error: "LOCAL_ONLY" }, { status: 403, headers: NO_STORE });
    const input = body.parse(await readJson(request, 1_000));
    const account = await localAccount();
    if (!account) return Response.json({ error: "NO_LOCAL_ACCOUNT" }, { status: 404, headers: NO_STORE });
    const result = await subscribe(input.planId, input.billing, regionFrom(request.headers, account.region));
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
    return errorResponse(error);
  }
}
