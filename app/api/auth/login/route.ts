import { trackAuth } from "@/lib/abuse/signals";
import { readJson } from "@/lib/http";
import { isMobileClient, MOBILE_SESSION_DAYS, sessionCookie, signIn, userFailure } from "@/lib/users/auth";

export const runtime = "nodejs";

/**
 * POST /api/auth/login { email, password, fingerprint? }. Wrong email and wrong password look identical.
 * The mobile app (X-AZ-Client: mobile) also receives its session token in the body, to keep in the
 * device's secure storage and send back as a Bearer token. Browsers only ever get the HttpOnly cookie.
 */
export async function POST(request: Request) {
  try {
    const body = await readJson(request, 2_000);
    const { token, user } = await signIn(request, body);
    const device = await trackAuth(request, user.id, "login", body);
    const headers = new Headers({ "Cache-Control": "no-store" });
    headers.append("Set-Cookie", sessionCookie(token));
    if (device) headers.append("Set-Cookie", device);
    const mobile = isMobileClient(request);
    return Response.json({ data: { user, ...(mobile ? { token, expiresInDays: MOBILE_SESSION_DAYS } : {}) } }, { headers });
  } catch (error) { return userFailure(error); }
}
