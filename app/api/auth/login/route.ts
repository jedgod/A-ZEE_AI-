import { trackAuth } from "@/lib/abuse/signals";
import { readJson } from "@/lib/http";
import { sessionCookie, signIn, userFailure } from "@/lib/users/auth";

export const runtime = "nodejs";

/** POST /api/auth/login { email, password, fingerprint? }. Wrong email and wrong password look identical. */
export async function POST(request: Request) {
  try {
    const body = await readJson(request, 2_000);
    const { token, user } = await signIn(request, body);
    const device = await trackAuth(request, user.id, "login", body);
    const headers = new Headers({ "Cache-Control": "no-store" });
    headers.append("Set-Cookie", sessionCookie(token));
    if (device) headers.append("Set-Cookie", device);
    return Response.json({ data: { user } }, { headers });
  } catch (error) { return userFailure(error); }
}
