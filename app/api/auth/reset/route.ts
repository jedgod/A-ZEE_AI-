import { readJson } from "@/lib/http";
import { userFailure } from "@/lib/users/auth";
import { resetPassword } from "@/lib/users/security";

export const runtime = "nodejs";

/** POST /api/auth/reset: sets a new password from an emailed link and signs out every session. */
export async function POST(request: Request) {
  try {
    await resetPassword(request, await readJson(request, 2_000));
    return Response.json({ data: { ok: true } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return userFailure(error); }
}
