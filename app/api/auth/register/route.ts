import { trackAuth } from "@/lib/abuse/signals";
import { readJson } from "@/lib/http";
import { register, sessionCookie, userFailure } from "@/lib/users/auth";

export const runtime = "nodejs";

/** POST /api/auth/register { name, email, password, fingerprint? }: creates the account and signs it in. */
export async function POST(request: Request) {
  try {
    const body = await readJson(request, 4_000);
    const { token, user } = await register(request, body);
    const device = await trackAuth(request, user.id, "signup", body);
    const headers = new Headers({ "Cache-Control": "no-store" });
    headers.append("Set-Cookie", sessionCookie(token));
    if (device) headers.append("Set-Cookie", device);
    return Response.json({ data: { user } }, { status: 201, headers });
  } catch (error) { return userFailure(error); }
}
