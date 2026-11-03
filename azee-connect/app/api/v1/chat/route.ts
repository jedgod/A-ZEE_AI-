import { z } from "zod";
import { authorize, PlatformError } from "@/lib/platform/auth";

export const runtime = "nodejs";

const schema = z.object({
  mode: z.enum(["chat", "code", "research"]).default("chat"),
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant"]),
      content: z.string().min(1).max(20000),
    }).strict()
  ).min(1).max(20),
}).strict();

export async function POST(request: Request) {
  try {
    await authorize(request, "chat:write");
    if (!request.headers.get("content-type")?.startsWith("application/json")) {
      throw new PlatformError(415, "JSON_REQUIRED");
    }
    if (!request.body) throw new PlatformError(400, "BODY_REQUIRED");

    const reader = request.body.getReader();
    const parts: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.length;
        if (length > 100000) {
          await reader.cancel();
          throw new PlatformError(413, "BODY_TOO_LARGE");
        }
        parts.push(part.value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.length;
    }
    const input = schema.parse(JSON.parse(new TextDecoder().decode(bytes)));
    if (input.messages.at(-1)?.role !== "user") {
      throw new PlatformError(422, "LAST_MESSAGE_MUST_BE_USER");
    }
    if (!process.env.AI_API_KEY || !process.env.AI_MODEL) {
      throw new PlatformError(503, "PROVIDER_NOT_CONFIGURED");
    }

    const system = input.mode === "code"
      ? "Explain and generate maintainable code. You cannot execute code."
      : input.mode === "research"
      ? "Distinguish evidence and assumptions. No live browsing tool is available."
      : "Be helpful, accurate, and candid about uncertainty.";

    const provider = await fetch(
      (process.env.AI_API_BASE ?? "https://api.openai.com/v1").replace(/\/$/, "") + "/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + process.env.AI_API_KEY,
        },
        body: JSON.stringify({
          model: process.env.AI_MODEL,
          messages: [{ role: "system", content: system }, ...input.messages],
          max_tokens: 1600,
          stream: false,
        }),
        signal: AbortSignal.timeout(60000),
      }
    );
    if (!provider.ok) throw new PlatformError(502, "PROVIDER_FAILURE");
    const payload = await provider.json();
    const answer = z.string().min(1).parse(payload.choices?.[0]?.message?.content);
    return Response.json(
      { data: { answer } },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const status = error instanceof PlatformError
      ? error.status
      : error instanceof z.ZodError || error instanceof SyntaxError
      ? 422
      : 502;
    const code = error instanceof PlatformError
      ? error.code
      : status === 422
      ? "INVALID_INPUT"
      : "SERVICE_UNAVAILABLE";
    return Response.json(
      { error: code },
      {
        status,
        headers: {
          "Cache-Control": "no-store",
          ...(status === 429 ? { "Retry-After": "60" } : {}),
        },
      }
    );
  }
}
