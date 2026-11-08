import { entitlementsFor } from "@/lib/linqext/service";
import { userFailure } from "@/lib/users/auth";

export const runtime = "nodejs";

/** GET: tier, what it allows, remaining monthly allowance and consent state, for the signed-in app or the linked keyboard. */
export async function GET(request: Request) {
  try { return Response.json({ data: await entitlementsFor(request) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return userFailure(error); }
}
