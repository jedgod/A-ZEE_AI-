import { readJson } from "@/lib/http";
import { userFailure } from "@/lib/users/auth";
import { forgotPassword } from "@/lib/users/security";

export const runtime = "nodejs";

/** POST /api/auth/forgot: starts a password reset. Always answers ok, whether or not the email has an account. */
export async function POST(request: Request) {
  try {
    await forgotPassword(request, await readJson(request, 1_000));
    return Response.json({ data: { ok: true } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return userFailure(error); }
}
