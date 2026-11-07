import { readJson } from "@/lib/http";
import { accountById, profileSchema, updateProfile } from "@/lib/accounts";
import { requireUser, sessionUser, userFailure } from "@/lib/users/auth";
import { currentStaff } from "@/lib/staff/auth";
import { errorResponse, NO_STORE, requireSameOrigin } from "@/lib/staff/route";

export const runtime = "nodejs";

/** Account menu data: the signed-in user's account and workspaces, plus any staff sign-in. */
export async function GET(request: Request) {
  try {
    const user = await sessionUser(request);
    const [account, staff] = await Promise.all([user ? accountById(user.id) : null, currentStaff().catch(() => null)]);
    return Response.json({
      data: {
        signedIn: Boolean(user),
        local: Boolean(user), // kept for older clients
        account,
        staff: staff && { name: staff.name, email: staff.email, role: staff.role },
        links: { terms: process.env.TERMS_URL || null, privacy: process.env.PRIVACY_URL || null, help: process.env.HELP_URL || null },
      },
    }, { headers: NO_STORE });
  } catch (error) { return errorResponse(error); }
}

/** Edit the signed-in account's profile (Profile in the account menu). */
export async function PATCH(request: Request) {
  try {
    const user = await requireUser(request, true);
    const updated = await updateProfile(user.id, profileSchema.parse(await readJson(request, 4_000)));
    if (!updated) return Response.json({ error: "NO_ACCOUNT" }, { status: 404, headers: NO_STORE });
    return Response.json({ data: updated }, { headers: NO_STORE });
  } catch (error) { return userFailure(error); }
}
