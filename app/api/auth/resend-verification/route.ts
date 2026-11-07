import { userFailure } from "@/lib/users/auth";
import { resendVerification } from "@/lib/users/security";

export const runtime = "nodejs";

/** POST /api/auth/resend-verification: sends a new verification email to the signed-in, unverified user. */
export async function POST(request: Request) {
  try {
    await resendVerification(request);
    return Response.json({ data: { ok: true } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return userFailure(error); }
}
