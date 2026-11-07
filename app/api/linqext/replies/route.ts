import { chatError } from "@/lib/chat/web";
import { readJson } from "@/lib/http";
import { createReply, LinqextError } from "@/lib/linqext/service";
import { userFailure } from "@/lib/users/auth";
import { UserError } from "@/lib/users/types";

export const runtime = "nodejs";

/** POST { requestId, message, context?, tone?, customTone?, variants?, consent: true } -> { data: { replies, tier, requestId, insertRequiresUserAction } }. No auto-send exists. */
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const { replay, result } = await createReply(request, await readJson(request, 40_000));
    return Response.json({ data: result }, { headers: replay ? { ...headers, "Idempotent-Replay": "true" } : headers });
  } catch (error) {
    if (error instanceof LinqextError) return Response.json({ error: error.code, ...error.extra }, { status: error.status, headers });
    if (error instanceof Response || error instanceof UserError || (error as Error)?.name === "ZodError" || error instanceof SyntaxError) return userFailure(error);
    const { status, body } = chatError(error);
    return Response.json(body, { status, headers });
  }
}
