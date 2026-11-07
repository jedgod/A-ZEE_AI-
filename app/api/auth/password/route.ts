import { readJson } from "@/lib/http";
import { userFailure } from "@/lib/users/auth";
import { changePassword } from "@/lib/users/security";

export const runtime = "nodejs";

/** POST /api/auth/password: changes the signed-in user's password and signs out their other sessions. */
export async function POST(request: Request) {
  try {
    await changePassword(request, await readJson(request, 2_000));
    return Response.json({ data: { ok: true } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return userFailure(error); }
}
