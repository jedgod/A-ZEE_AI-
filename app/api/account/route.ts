import { readJson } from "@/lib/http";
import { localAccount, profileSchema, updateLocalProfile } from "@/lib/accounts";
import { isLocalRequest } from "@/lib/pipeline/actor";
import { currentStaff } from "@/lib/staff/auth";
import { errorResponse, NO_STORE, requireSameOrigin } from "@/lib/staff/route";

export const runtime = "nodejs";

/** Account menu data: the local account (this machine only), its workspaces, and any staff sign-in. */
export async function GET(request: Request) {
  try {
    const local = isLocalRequest(request);
    const [account, staff] = await Promise.all([local ? localAccount() : null, currentStaff().catch(() => null)]);
    return Response.json({
      data: {
        local,
        account,
        staff: staff && { name: staff.name, email: staff.email, role: staff.role },
        links: { terms: process.env.TERMS_URL || null, privacy: process.env.PRIVACY_URL || null, help: process.env.HELP_URL || null },
      },
    }, { headers: NO_STORE });
  } catch (error) { return errorResponse(error); }
}

/** Edit the local account's profile (Profile in the account menu). */
export async function PATCH(request: Request) {
  try {
    requireSameOrigin(request);
    if (!isLocalRequest(request)) return Response.json({ error: "LOCAL_ONLY" }, { status: 403, headers: NO_STORE });
    const updated = await updateLocalProfile(profileSchema.parse(await readJson(request, 4_000)));
    if (!updated) return Response.json({ error: "NO_LOCAL_ACCOUNT" }, { status: 404, headers: NO_STORE });
    return Response.json({ data: updated }, { headers: NO_STORE });
  } catch (error) { return errorResponse(error); }
}
