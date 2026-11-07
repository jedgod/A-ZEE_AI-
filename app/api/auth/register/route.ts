import { readJson } from "@/lib/http";
import { register, sessionCookie, userFailure } from "@/lib/users/auth";

export const runtime = "nodejs";

/** POST /api/auth/register { name, email, password }: creates the account and signs it in. */
export async function POST(request: Request) {
  try {
    const { token, user } = await register(request, await readJson(request, 4_000));
    return Response.json({ data: { user } }, { status: 201, headers: { "Cache-Control": "no-store", "Set-Cookie": sessionCookie(token) } });
  } catch (error) { return userFailure(error); }
}
