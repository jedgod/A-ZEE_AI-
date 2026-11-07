import { entitlementsFor } from "@/lib/linqext/service";
import { userFailure } from "@/lib/users/auth";

export const runtime = "nodejs";

/** GET: the signed-in user's tier and what it allows, from their real A-Zee plan. */
export async function GET(request: Request) {
  try {
    const { tier, plan, features, monthlyReplies } = await entitlementsFor(request);
    return Response.json({ data: { tier, plan, features, monthlyReplies } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return userFailure(error); }
}
