import { readJson } from "@/lib/http";
import { userFailure } from "@/lib/users/auth";
import { verifyEmail } from "@/lib/users/security";

export const runtime = "nodejs";

/** POST /api/auth/verify: spends an emailed verification link. */
export async function POST(request: Request) {
  try {
    await verifyEmail(request, await readJson(request, 1_000));
    return Response.json({ data: { ok: true } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return userFailure(error); }
}
