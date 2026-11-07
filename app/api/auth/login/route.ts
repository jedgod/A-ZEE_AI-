import { readJson } from "@/lib/http";
import { sessionCookie, signIn, userFailure } from "@/lib/users/auth";

export const runtime = "nodejs";

/** POST /api/auth/login { email, password }. Wrong email and wrong password look identical. */
export async function POST(request: Request) {
  try {
    const { token, user } = await signIn(request, await readJson(request, 2_000));
    return Response.json({ data: { user } }, { headers: { "Cache-Control": "no-store", "Set-Cookie": sessionCookie(token) } });
  } catch (error) { return userFailure(error); }
}
