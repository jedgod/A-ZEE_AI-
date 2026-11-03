import { z } from "zod";
import { runCorrectionCapture } from "@/13_FEEDBACK/correction_capture/module";
import { runUserRating } from "@/13_FEEDBACK/user_rating/module";
import { readJson } from "@/lib/http";
import { readAnonId, webActor } from "@/lib/pipeline/actor";
import { feedbackRepository, ownsRequest } from "@/lib/pipeline/operations";
import { PiiVault } from "@/lib/pipeline/preprocess";

export const runtime = "nodejs";

const bodySchema = z.object({
  requestId: z.string().uuid(),
  rating: z.number().int().min(1).max(5).optional(),
  correction: z.string().trim().min(1).max(5000).optional(),
}).strict().refine(b => b.rating !== undefined || b.correction !== undefined, { message: "rating or correction required" });

/** 13_FEEDBACK: ratings and corrections for answers this browser received. */
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const origin = request.headers.get("origin");
  if (origin && origin !== (process.env.APP_ORIGIN || "http://localhost:3000")) {
    return Response.json({ error: "INVALID_ORIGIN" }, { status: 403, headers });
  }
  if (!process.env.DATABASE_URL) return Response.json({ error: "FEEDBACK_UNAVAILABLE" }, { status: 503, headers });
  if (!readAnonId(request)) return Response.json({ error: "UNKNOWN_REQUEST" }, { status: 404, headers });
  try {
    const body = bodySchema.parse(await readJson(request, 20_000));
    const { auth } = webActor(request).actor;
    // Only the browser that received the answer may rate it; others get the same 404.
    if (!await ownsRequest(auth, body.requestId)) return Response.json({ error: "UNKNOWN_REQUEST" }, { status: 404, headers });
    if (body.rating !== undefined) await runUserRating(auth, { requestId: body.requestId, rating: body.rating }, feedbackRepository);
    if (body.correction !== undefined) {
      // Data minimization: strip personal data from free text before storage.
      const correction = new PiiVault().redact(body.correction);
      await runCorrectionCapture(auth, { requestId: body.requestId, correction }, feedbackRepository);
    }
    return Response.json({ data: { saved: true } }, { status: 201, headers });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ error: "INVALID_INPUT" }, { status: 422, headers });
    return Response.json({ error: "SERVICE_UNAVAILABLE" }, { status: 503, headers });
  }
}
