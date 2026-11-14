import { releaseSource } from "@/lib/video-upload";
import { finishJob, isJobId, normalizeWebhook, secretMatches } from "@/lib/video-jobs";

export const runtime = "nodejs";

const headers = { "Cache-Control": "no-store" };

/**
 * Video provider callback: POST /api/webhooks/video?jobId=<uuid>. Authenticated by VIDEO_WEBHOOK_SECRET,
 * sent as the x-webhook-secret header (or ?token= for providers that cannot set headers; query strings can
 * end up in logs, so prefer the header). With no secret configured every call is refused.
 */
export async function POST(request: Request) {
  if (!process.env.VIDEO_WEBHOOK_SECRET) return Response.json({ error: "WEBHOOK_NOT_CONFIGURED" }, { status: 503, headers });
  const url = new URL(request.url);
  if (!secretMatches(request.headers.get("x-webhook-secret") ?? url.searchParams.get("token"))) return Response.json({ error: "UNAUTHORIZED" }, { status: 401, headers });
  const raw = await request.text();
  if (raw.length > 256_000) return Response.json({ error: "BODY_TOO_LARGE" }, { status: 413, headers });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return Response.json({ error: "INVALID_JSON" }, { status: 422, headers }); }
  const jobId = url.searchParams.get("jobId") ?? (body as { jobId?: unknown })?.jobId ?? (body as { metadata?: { jobId?: unknown } })?.metadata?.jobId;
  if (typeof jobId !== "string" || !isJobId(jobId)) return Response.json({ error: "INVALID_JOB" }, { status: 422, headers });
  try {
    const result = await finishJob(jobId, normalizeWebhook(body));
    if (result === "updated") await releaseSource(jobId); // an Edit Video job no longer needs its source clip
    return Response.json({ received: true, result }, { headers });
  } catch (error) {
    console.error("video webhook failed:", (error as Error).message);
    return Response.json({ error: "SERVICE_UNAVAILABLE" }, { status: 503, headers }); // the provider retries
  }
}
