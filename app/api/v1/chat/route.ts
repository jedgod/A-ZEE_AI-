import { z } from "zod";
import { authorize, PlatformError } from "@/lib/platform/auth";
import { chatRequestSchema } from "@/lib/chat/contracts";
import { ProviderError } from "@/lib/chat/provider";
import { answerChat, InputBlockedError, NotPermittedError, OutputBlockedError } from "@/lib/pipeline";
import { platformActor } from "@/lib/pipeline/actor";
import { readJson } from "@/lib/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const key = await authorize(request, "chat:write");
    const input = chatRequestSchema.parse(await readJson(request, 2_000_000));
    const { answer, meta } = await answerChat(input, platformActor(key));
    return Response.json({ data: { answer, pipeline: meta } }, { headers });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof InputBlockedError) return Response.json({ error: "INPUT_BLOCKED" }, { status: 422, headers });
    if (error instanceof OutputBlockedError) return Response.json({ error: "OUTPUT_BLOCKED" }, { status: 422, headers });
    if (error instanceof NotPermittedError) return Response.json({ error: "NOT_PERMITTED", reasons: error.reasons }, { status: 403, headers });
    const status = error instanceof PlatformError || error instanceof ProviderError ? error.status
      : error instanceof z.ZodError || error instanceof SyntaxError ? 422 : 503;
    const code = error instanceof PlatformError || error instanceof ProviderError ? error.code
      : status === 422 ? "INVALID_INPUT" : "SERVICE_UNAVAILABLE";
    return Response.json({ error: code }, { status, headers: { ...headers, ...(status === 429 ? { "Retry-After": "60" } : {}) } });
  }
}
