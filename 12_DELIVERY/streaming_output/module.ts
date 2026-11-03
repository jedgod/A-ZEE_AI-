// ============================================================
// 12_DELIVERY / STREAMING_OUTPUT
// File: lib/operations/streaming_output.ts — SERVER ONLY
// ============================================================

import "server-only";
import { z } from "zod";
import {
  type Auth, type ArtifactRepository, type RecordRepository,
  requireAuth, artifactSchema, expiresIn
} from "../../lib/operations/contracts";

// ------------------------------------------------------------
// Shared SSE helpers. /api/chat/stream (validated live answers) and runStreamingOutput
// (stored, approved artifacts) both deliver through these.
// ------------------------------------------------------------
const encoder = new TextEncoder();

/** One Server-Sent Events frame. Data is JSON, so it can never contain a raw blank line. */
export function encodeSseEvent(event: string, data: unknown): Uint8Array {
  if (!/^[a-z_]{1,32}$/.test(event)) throw new Error("Invalid SSE event name");
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Splits validated text into delivery chunks of at most `size` characters, preferring to cut
 * after whitespace. Joining the chunks gives back the exact text (Unicode-safe).
 */
export function sseTextChunks(text: string, size = 500): string[] {
  if (!Number.isInteger(size) || size < 16 || size > 4000) throw new Error("Invalid chunk size");
  const chars = Array.from(text);
  const chunks: string[] = [];
  for (let i = 0; i < chars.length;) {
    let end = Math.min(i + size, chars.length);
    if (end < chars.length) {
      const space = chars.slice(i, end).map(c => /\s/.test(c)).lastIndexOf(true);
      if (space > 0) end = i + space + 1;
    }
    chunks.push(chars.slice(i, end).join(""));
    i = end;
  }
  return chunks;
}

export async function runStreamingOutput(
  auth: Auth, artifactId: string, repository: ArtifactRepository
) {
  requireAuth(auth);
  z.string().uuid().parse(artifactId);
  const artifact = artifactSchema.parse(
    await repository.readApproved(auth, artifactId)
  );
  const chunks = sseTextChunks(artifact.text, 500);
  let index = 0;

  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encodeSseEvent("chunk", { text: chunks[index++] }));
      } else {
        controller.enqueue(encodeSseEvent("done", { artifactId: artifact.id }));
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Accel-Buffering": "no",
  } });
}

// ReadableStream pull respects consumer backpressure.
// Client parses SSE frames incrementally, including partial frames.
// For live model streaming, buffer until policy/schema checks pass.
