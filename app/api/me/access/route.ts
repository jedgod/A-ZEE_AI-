import { accessFor, usageFor } from "@/lib/plans";
import { actorFor } from "@/lib/users/auth";
import { errorResponse, NO_STORE } from "@/lib/staff/route";

export const runtime = "nodejs";

/**
 * Current plan and entitlements (from subscription-access-rule). The UI uses this to show or
 * disable features; the server enforces the same rules on every request regardless.
 */
export async function GET(request: Request) {
  try {
    const access = await accessFor((await actorFor(request)).actor);
    const used = await usageFor(access.subject);
    return Response.json({
      data: {
        plan: access.planId,
        planName: access.planName,
        entitlements: Object.entries(access.entitlements).map(([feature, g]) => ({ feature, enabled: g.enabled, monthlyLimit: g.monthlyLimit, used: used[feature] ?? 0 })),
      },
    }, { headers: NO_STORE });
  } catch (error) { return errorResponse(error); }
}
