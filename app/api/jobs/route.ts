import { body, handle, NO_STORE, sidebarOwner } from "@/lib/sidebar-route";
import { DailyLimitError, SourceNotFoundError, startJob } from "@/lib/video-provider";
import { createJobInput, JobLimitError } from "@/lib/video-jobs";

export const runtime = "nodejs";

/**
 * POST /api/jobs { kind: "create_video" | "edit_video", prompt, inputUrl? } -> { job } (201).
 * Creates a job for the signed-in account and starts it: a real Fal.ai request when FAL_KEY is set (and the server
 * is not in ollama-only mode), otherwise a simulated preview. The job says which ("provider").
 */
export function POST(request: Request) {
  return handle(async () => {
    const owner = await sidebarOwner(request, true);
    try {
      return Response.json({ job: await startJob(owner, createJobInput.parse(await body(request))) }, { status: 201, headers: NO_STORE });
    } catch (error) {
      if (error instanceof JobLimitError) return Response.json({ error: "TOO_MANY_JOBS" }, { status: 429, headers: { ...NO_STORE, "Retry-After": "60" } });
      if (error instanceof DailyLimitError) return Response.json({ error: "DAILY_VIDEO_LIMIT" }, { status: 429, headers: { ...NO_STORE, "Retry-After": "3600" } });
      if (error instanceof SourceNotFoundError) return Response.json({ error: "SOURCE_NOT_FOUND" }, { status: 422, headers: NO_STORE });
      throw error;
    }
  });
}
