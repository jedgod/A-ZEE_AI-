import { readJson } from "@/lib/http";
import { preferencesSchema, updateLocalPreferences } from "@/lib/accounts";
import { isLocalRequest } from "@/lib/pipeline/actor";
import { errorResponse, NO_STORE, requireSameOrigin } from "@/lib/staff/route";

export const runtime = "nodejs";

/** Personalization: custom instructions and answer style, applied to every chat answer. */
export async function PUT(request: Request) {
  try {
    requireSameOrigin(request);
    if (!isLocalRequest(request)) return Response.json({ error: "LOCAL_ONLY" }, { status: 403, headers: NO_STORE });
    const updated = await updateLocalPreferences(preferencesSchema.parse(await readJson(request, 8_000)));
    if (!updated) return Response.json({ error: "NO_LOCAL_ACCOUNT" }, { status: 404, headers: NO_STORE });
    return Response.json({ data: updated.preferences }, { headers: NO_STORE });
  } catch (error) { return errorResponse(error); }
}
