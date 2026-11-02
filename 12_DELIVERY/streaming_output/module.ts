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

export async function runStreamingOutput(
  auth: Auth, artifactId: string, repository: ArtifactRepository
) {
  requireAuth(auth);
  z.string().uuid().parse(artifactId);
  const artifact = artifactSchema.parse(
    await repository.readApproved(auth, artifactId)
  );
  const encoder = new TextEncoder();
  const chunks = artifact.text.match(/[\s\S]{1,500}/gu) ?? [];
  let index = 0;

  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(
          "event: chunk\ndata: " +
          JSON.stringify({ text: chunks[index++] }) + "\n\n"
        ));
      } else {
        controller.enqueue(encoder.encode(
          "event: done\ndata: " +
          JSON.stringify({ artifactId: artifact.id }) + "\n\n"
        ));
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
