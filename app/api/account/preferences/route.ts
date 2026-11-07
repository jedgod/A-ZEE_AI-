import { readJson } from "@/lib/http";
import { preferencesSchema, updatePreferences } from "@/lib/accounts";
import { NO_STORE } from "@/lib/staff/route";
import { requireUser, userFailure } from "@/lib/users/auth";

export const runtime = "nodejs";

/** Personalization: custom instructions and answer style, applied to every chat answer. */
export async function PUT(request: Request) {
  try {
    const user = await requireUser(request, true);
    const updated = await updatePreferences(user.id, preferencesSchema.parse(await readJson(request, 8_000)));
    if (!updated) return Response.json({ error: "NO_ACCOUNT" }, { status: 404, headers: NO_STORE });
    return Response.json({ data: updated.preferences }, { headers: NO_STORE });
  } catch (error) { return userFailure(error); }
}
