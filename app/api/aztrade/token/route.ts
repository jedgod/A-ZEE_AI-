import { allow, requireUser, userFailure } from "@/lib/users/auth";
import { UserError } from "@/lib/users/types";
import { AztradeUnavailable, mintToken } from "@/lib/aztrade/identity";
import { JwtError } from "@/lib/aztrade/jwt";

export const runtime = "nodejs";

/**
 * POST: a 5-minute AZTrade access token for the signed-in session that makes this request. Same-origin and write
 * rate limits apply (requireUser with write = true). Nothing about identity is read from the body.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request, true);
    if (!await allow("aztrade-token", user.id, 12)) throw new UserError(429, "RATE_LIMITED");
    return Response.json(await mintToken(request), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AztradeUnavailable) return Response.json({ error: "AZTRADE_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    if (error instanceof JwtError) return Response.json({ error: "SIGN_IN_REQUIRED" }, { status: 401, headers: { "Cache-Control": "no-store" } });
    return userFailure(error);
  }
}
