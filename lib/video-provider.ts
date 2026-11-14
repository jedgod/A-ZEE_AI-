import "server-only";
import { ollamaOnly } from "@/lib/pipeline/privacy";
import { ownsSource, releaseSource } from "@/lib/video-upload";
import { createJob, failJob, finishJob, getJob, httpsUrl, jobRef, realJobsToday, setProvider, type MediaJob } from "@/lib/video-jobs";

// Where a video job is actually made.
//  - "fal":       a real Fal.ai request (needs FAL_KEY, and the server must not be in AZ_PROVIDER_MODE=ollama-only).
//  - "simulated": a preview with a sample clip, so the whole app flow can be tried without a key or a bill.
//                 It is labelled as simulated in the job and in the app, and never pretends to be the prompt's video.
// A Fal job finishes through the webhook when VIDEO_WEBHOOK_BASE_URL (a public https address) is set, and is also
// checked against Fal's queue whenever the app asks for the job, so it works with no public tunnel at all.

export type Provider = "simulated" | "fal";
export const SIM_SECONDS = 8;
const GIVE_UP_MS = 30 * 60 * 1000;
const SAMPLE_CLIP = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";

export class DailyLimitError extends Error { constructor() { super("DAILY_VIDEO_LIMIT"); } }
/** An Edit Video job named a clip the account did not upload (or one already deleted). */
export class SourceNotFoundError extends Error { constructor() { super("SOURCE_NOT_FOUND"); } }

const falKey = () => process.env.FAL_KEY?.trim() || "";
const MODEL_ID = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9._-]*)+$/i;
// Model ids are configurable; the defaults are starting points to confirm against Fal's current catalogue.
const model = (kind: MediaJob["kind"]) => {
  const env = process.env;
  const id = (kind === "edit_video"
    ? env.FAL_EDIT_VIDEO_MODEL || env.FAL_VIDEO_EDIT_MODEL || "fal-ai/wan-v2.1/v2v"
    : env.FAL_CREATE_VIDEO_MODEL || env.FAL_VIDEO_MODEL || "fal-ai/minimax/video-01")?.trim();
  return id && MODEL_ID.test(id) ? id : null;
};
const dailyLimit = () => Math.max(1, Number(process.env.VIDEO_DAILY_LIMIT) || 5);

/** Which engine would handle a job of this kind right now. */
export function chooseProvider(kind: MediaJob["kind"]): Provider {
  if (ollamaOnly()) return "simulated"; // private mode: prompts and videos never go to an outside service
  if (!falKey() || !model(kind)) return "simulated";
  return "fal";
}

const webhookUrl = (jobId: string) => {
  const base = process.env.VIDEO_WEBHOOK_BASE_URL?.trim().replace(/\/+$/, ""), secret = process.env.VIDEO_WEBHOOK_SECRET;
  if (!base || !secret || !/^https:\/\//.test(base)) return null;
  return `${base}/api/webhooks/video?jobId=${jobId}&token=${encodeURIComponent(secret)}`;
};

type Ref = { statusUrl: string; responseUrl: string };
/** Only Fal's own queue host is ever called with the key. */
const queueUrl = (v: unknown): string | null => {
  try { const u = new URL(String(v)); return u.protocol === "https:" && u.hostname === "queue.fal.run" ? u.toString() : null; } catch { return null; }
};

async function submitToFal(job: MediaJob, fetchImpl: typeof fetch): Promise<Ref> {
  const id = model(job.kind)!;
  const hook = webhookUrl(job.id);
  const res = await fetchImpl(`https://queue.fal.run/${id}${hook ? `?fal_webhook=${encodeURIComponent(hook)}` : ""}`, {
    method: "POST",
    headers: { Authorization: `Key ${falKey()}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ prompt: job.prompt, ...(job.kind === "edit_video" && job.inputUrl ? { video_url: job.inputUrl } : {}) }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`fal ${res.status}`);
  const data = await res.json() as { status_url?: string; response_url?: string };
  const statusUrl = queueUrl(data.status_url), responseUrl = queueUrl(data.response_url);
  if (!statusUrl || !responseUrl) throw new Error("fal: unexpected response");
  return { statusUrl, responseUrl };
}

/**
 * Creates the job for the account and hands it to its engine. A real (Fal) job counts against a daily limit
 * (VIDEO_DAILY_LIMIT, default 5) because each one costs money; simulated previews are free and unlimited.
 * If Fal rejects the request the job is returned already failed.
 */
export async function startJob(ownerId: string, input: Parameters<typeof createJob>[1], fetchImpl: typeof fetch = fetch): Promise<MediaJob> {
  if (input.kind === "edit_video" && !(input.inputUrl && await ownsSource(ownerId, input.inputUrl))) throw new SourceNotFoundError();
  const provider = chooseProvider(input.kind);
  if (provider === "fal" && await realJobsToday(ownerId) >= dailyLimit()) throw new DailyLimitError();
  const job = await createJob(ownerId, input);
  if (provider === "simulated") return job; // the column default is already "simulated"
  try {
    await setProvider(job.id, "fal", JSON.stringify(await submitToFal(job, fetchImpl)));
    return { ...job, provider: "fal" };
  } catch (error) {
    console.warn("video provider submit failed:", (error as Error).message.slice(0, 200));
    await failJob(job.id);
    await releaseSource(job.id);
    return { ...job, provider: "fal", status: "failed" };
  }
}

const videoOf = (data: any): string | null => httpsUrl(data?.video?.url) ?? httpsUrl(data?.videos?.[0]?.url) ?? httpsUrl(data?.output?.video?.url) ?? httpsUrl(data?.url);

/**
 * Brings a still-processing job up to date and returns the latest version. A simulated job completes once its
 * few seconds are up; a Fal job is checked against Fal's queue. Anything else is returned as it is.
 */
export async function refreshJob(ownerId: string, job: MediaJob, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<MediaJob> {
  if (job.status !== "processing") { if (job.kind === "edit_video") await releaseSource(job.id); return job; } // finished (possibly by webhook): make sure the source clip is gone
  const age = now - new Date(job.createdAt).getTime();
  if (job.provider === "simulated") {
    if (age >= SIM_SECONDS * 1000) await finishJob(job.id, { status: "completed", videoUrl: httpsUrl(process.env.VIDEO_SIM_URL) ?? SAMPLE_CLIP });
  } else if (job.provider === "fal" && falKey()) {
    try {
      const ref = JSON.parse((await jobRef(job.id)) ?? "null") as Ref | null;
      const statusUrl = queueUrl(ref?.statusUrl), responseUrl = queueUrl(ref?.responseUrl);
      if (!statusUrl || !responseUrl) { await failJob(job.id); }
      else {
        const headers = { Authorization: `Key ${falKey()}`, Accept: "application/json" };
        const status = await fetchImpl(statusUrl, { headers, signal: AbortSignal.timeout(15_000) });
        if (status.ok) {
          if ((await status.json() as { status?: string }).status === "COMPLETED") {
            const result = await fetchImpl(responseUrl, { headers, signal: AbortSignal.timeout(15_000) });
            const url = result.ok ? videoOf(await result.json().catch(() => null)) : null;
            await finishJob(job.id, url ? { status: "completed", videoUrl: url } : { status: "failed", videoUrl: null });
          }
        } else if (status.status >= 400 && status.status < 500) await failJob(job.id); // the request is gone or was refused
      }
    } catch { /* a network blip is retried on the next poll */ }
    if (age > GIVE_UP_MS) await failJob(job.id); // no result after 30 minutes
  }
  const latest = (await getJob(ownerId, job.id)) ?? job;
  if (latest.status !== "processing" && latest.kind === "edit_video") await releaseSource(latest.id); // the provider is done with the clip
  return latest;
}
