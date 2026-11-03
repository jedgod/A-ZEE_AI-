import { chatRequestSchema } from "@/lib/chat/contracts";
import { chatAllowed, chatError, sameOrigin } from "@/lib/chat/web";
import { answerChat } from "@/lib/pipeline";
import { anonCookie, webActor } from "@/lib/pipeline/actor";
import { readJson } from "@/lib/http";

export const runtime = "nodejs";

/** Browser chat, whole answer as JSON. /api/chat/stream is the streaming variant. */
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  try {
    if (!sameOrigin(request)) return Response.json({ error: "INVALID_ORIGIN" }, { status: 403, headers });
    if (!await chatAllowed(request)) return Response.json({ error: "RATE_LIMITED" }, {
      status: 429, headers: { ...headers, "Retry-After": "60" },
    });
    const input = chatRequestSchema.parse(await readJson(request, 2_000_000));
    const { actor, newAnonId } = webActor(request);
    const { answer, meta } = await answerChat(input, actor);
    return Response.json({ data: { answer, pipeline: meta } }, {
      headers: { ...headers, ...(newAnonId ? { "Set-Cookie": anonCookie(newAnonId) } : {}) },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    const { status, body } = chatError(error);
    return Response.json(body, { status, headers });
  }
}
