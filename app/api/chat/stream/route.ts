import { canSeeProviders, publicMeta } from "@/lib/admin/provider-access";
import { chatRequestSchema } from "@/lib/chat/contracts";
import { chatAllowed, chatError, sameOrigin } from "@/lib/chat/web";
import { answerChat } from "@/lib/pipeline";
import { anonCookie } from "@/lib/pipeline/actor";
import { actorFor } from "@/lib/users/auth";
import { readJson } from "@/lib/http";
import { encodeSseEvent, sseTextChunks } from "@/12_DELIVERY/streaming_output/module";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 12 streaming delivery (Server-Sent Events over a fetch POST). Same checks and pipeline as
 * /api/chat; nothing is stored. Events, in order:
 *   status {stage}           while the pipeline runs (preprocess, search, tools, plan, generate, validate, deliver)
 *   tool   {name, status}    07 tool calls (running / complete / failed)
 *   delta  {text}            answer text, sent only AFTER 10 validation passed (no unvalidated drafts)
 *   final  {pipeline}        the same metadata /api/chat returns (requestId, sources, quality, ...)
 *   error  {error, ...}      the same error codes /api/chat returns, then the stream ends
 * Errors found before the stream starts (origin, rate limit, invalid input) are plain JSON responses.
 * Stop/disconnect aborts in-flight provider calls.
 */
export async function POST(request: Request) {
  const json = { "Cache-Control": "no-store" };
  let input;
  try {
    if (!sameOrigin(request)) return Response.json({ error: "INVALID_ORIGIN" }, { status: 403, headers: json });
    if (!await chatAllowed(request)) return Response.json({ error: "RATE_LIMITED" }, { status: 429, headers: { ...json, "Retry-After": "60" } });
    input = chatRequestSchema.parse(await readJson(request, 2_000_000));
  } catch (error) {
    if (error instanceof Response) return error;
    const { status, body } = chatError(error);
    return Response.json(body, { status, headers: json });
  }

  const { actor, newAnonId } = await actorFor(request);
  const abort = new AbortController();
  const signal = AbortSignal.any([request.signal, abort.signal]);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: string, data: unknown) => {
        if (!open) return;
        try { controller.enqueue(encodeSseEvent(event, data)); }
        catch { open = false; abort.abort(); }
      };
      try {
        const { answer, meta } = await answerChat(input, actor, fetch, {
          signal,
          onEvent: event => event.type === "status"
            ? send("status", { stage: event.stage })
            : send("tool", { name: event.name, status: event.status }),
        });
        // 12 streaming_output: whitespace-aligned chunks of the validated answer.
        for (const text of sseTextChunks(answer, 120)) {
          if (signal.aborted) break;
          send("delta", { text });
        }
        send("final", { pipeline: publicMeta(meta, await canSeeProviders()) });
      } catch (error) {
        if (!signal.aborted) send("error", chatError(error).body);
      } finally {
        open = false;
        try { controller.close(); } catch { /* already closed by the client */ }
      }
    },
    cancel() { abort.abort(); },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
      ...(newAnonId ? { "Set-Cookie": anonCookie(newAnonId) } : {}),
    },
  });
}
