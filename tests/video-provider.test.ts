import { beforeEach, describe, expect, it, vi } from "vitest";

const jobs = vi.hoisted(() => ({
  createJob: vi.fn(), failJob: vi.fn(async () => undefined), finishJob: vi.fn(async () => "updated"), getJob: vi.fn(), jobRef: vi.fn(), realJobsToday: vi.fn(async () => 0), setProvider: vi.fn(async () => undefined),
  httpsUrl: (v: unknown) => (typeof v === "string" && /^https:\/\/[^\s]+$/.test(v) ? v : null),
}));
vi.mock("@/lib/video-jobs", () => jobs);
const uploads = vi.hoisted(() => ({ ownsSource: vi.fn(async () => true), releaseSource: vi.fn(async () => undefined) }));
vi.mock("@/lib/video-upload", () => uploads);

import { chooseProvider, DailyLimitError, refreshJob, SIM_SECONDS, SourceNotFoundError, startJob } from "@/lib/video-provider";

const env = process.env as Record<string, string | undefined>;
const ID = "3f0c9a52-1b7e-4d3a-9c55-0a1b2c3d4e5f";
const job = (over: object = {}) => ({ id: ID, kind: "create_video", status: "processing", provider: "simulated", prompt: "a drone shot", inputUrl: null, outputUrl: null, createdAt: new Date(1_000_000).toISOString(), ...over });
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const REF = JSON.stringify({ statusUrl: "https://queue.fal.run/fal-ai/minimax/requests/abc/status", responseUrl: "https://queue.fal.run/fal-ai/minimax/requests/abc" });

beforeEach(() => {
  for (const f of [...Object.values(jobs), ...Object.values(uploads)]) (f as { mockClear?: () => void }).mockClear?.();
  uploads.ownsSource.mockResolvedValue(true);
  jobs.realJobsToday.mockResolvedValue(0);
  for (const k of ["FAL_KEY", "FAL_VIDEO_MODEL", "FAL_VIDEO_EDIT_MODEL", "FAL_EDIT_VIDEO_MODEL", "FAL_CREATE_VIDEO_MODEL", "AZ_PROVIDER_MODE", "VIDEO_DAILY_LIMIT", "VIDEO_WEBHOOK_BASE_URL", "VIDEO_WEBHOOK_SECRET", "VIDEO_SIM_URL"]) delete env[k];
});

describe("chooseProvider", () => {
  it("simulates without a key", () => expect(chooseProvider("create_video")).toBe("simulated"));
  it("uses Fal with a key", () => { env.FAL_KEY = "k"; expect(chooseProvider("create_video")).toBe("fal"); });
  it("never uses Fal in ollama-only mode, even with a key", () => { env.FAL_KEY = "k"; env.AZ_PROVIDER_MODE = "ollama-only"; expect(chooseProvider("create_video")).toBe("simulated"); });
  it("uses Fal for edits by default, and simulates when the configured edit model id is malformed", () => {
    env.FAL_KEY = "k";
    expect(chooseProvider("edit_video")).toBe("fal");
    env.FAL_EDIT_VIDEO_MODEL = "not a model";
    expect(chooseProvider("edit_video")).toBe("simulated");
  });
  it("ignores a malformed model id", () => { env.FAL_KEY = "k"; env.FAL_VIDEO_MODEL = "https://evil.example/x"; expect(chooseProvider("create_video")).toBe("simulated"); });
});

describe("startJob", () => {
  it("creates a simulated job without calling any provider", async () => {
    jobs.createJob.mockResolvedValueOnce(job());
    const f = vi.fn();
    expect((await startJob("u1", { kind: "create_video", prompt: "x" }, f as unknown as typeof fetch)).provider).toBe("simulated");
    expect(f).not.toHaveBeenCalled();
  });
  it("submits to Fal's queue with the key and stores the queue URLs", async () => {
    env.FAL_KEY = "secret-key";
    jobs.createJob.mockResolvedValueOnce(job());
    const f = vi.fn(async () => reply({ status_url: "https://queue.fal.run/fal-ai/minimax/requests/abc/status", response_url: "https://queue.fal.run/fal-ai/minimax/requests/abc" }));
    const r = await startJob("u1", { kind: "create_video", prompt: "a drone shot" }, f as unknown as typeof fetch);
    expect(r.provider).toBe("fal");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://queue.fal.run/fal-ai/minimax/video-01");
    expect((init.headers as Record<string, string>).Authorization).toBe("Key secret-key");
    expect(JSON.parse(String(init.body))).toEqual({ prompt: "a drone shot" });
    expect(jobs.setProvider).toHaveBeenCalledWith(ID, "fal", REF);
  });
  it("adds the webhook only for a public https base", async () => {
    env.FAL_KEY = "k"; env.VIDEO_WEBHOOK_SECRET = "s"; env.VIDEO_WEBHOOK_BASE_URL = "https://abc.ngrok.app/";
    jobs.createJob.mockResolvedValueOnce(job());
    const f = vi.fn(async () => reply({ status_url: "https://queue.fal.run/a/requests/1/status", response_url: "https://queue.fal.run/a/requests/1" }));
    await startJob("u1", { kind: "create_video", prompt: "x" }, f as unknown as typeof fetch);
    const url = (f.mock.calls[0] as unknown as [string])[0];
    expect(decodeURIComponent(url.split("fal_webhook=")[1])).toBe(`https://abc.ngrok.app/api/webhooks/video?jobId=${ID}&token=s`);
    env.VIDEO_WEBHOOK_BASE_URL = "http://localhost:3001";
    jobs.createJob.mockResolvedValueOnce(job());
    await startJob("u1", { kind: "create_video", prompt: "x" }, f as unknown as typeof fetch);
    expect((f.mock.calls[1] as unknown as [string])[0]).not.toContain("fal_webhook");
  });
  it("returns a failed job when Fal refuses, and rejects URLs that are not Fal's queue", async () => {
    env.FAL_KEY = "k";
    jobs.createJob.mockResolvedValue(job());
    expect((await startJob("u1", { kind: "create_video", prompt: "x" }, (async () => reply({}, 401)) as unknown as typeof fetch)).status).toBe("failed");
    expect((await startJob("u1", { kind: "create_video", prompt: "x" }, (async () => reply({ status_url: "https://evil.example/s", response_url: "https://evil.example/r" })) as unknown as typeof fetch)).status).toBe("failed");
    expect(jobs.failJob).toHaveBeenCalledTimes(2);
  });
  it("stops real jobs at the daily limit before creating anything", async () => {
    env.FAL_KEY = "k"; env.VIDEO_DAILY_LIMIT = "2";
    jobs.realJobsToday.mockResolvedValueOnce(2);
    await expect(startJob("u1", { kind: "create_video", prompt: "x" })).rejects.toBeInstanceOf(DailyLimitError);
    expect(jobs.createJob).not.toHaveBeenCalled();
  });
});

describe("Edit Video", () => {
  const edit = { kind: "edit_video" as const, prompt: "make it night", inputUrl: "https://utfs.io/f/clip.mp4" };
  it("refuses a source clip the account did not upload, before creating or calling anything", async () => {
    uploads.ownsSource.mockResolvedValueOnce(false);
    const f = vi.fn();
    await expect(startJob("u1", edit, f as unknown as typeof fetch)).rejects.toBeInstanceOf(SourceNotFoundError);
    expect(uploads.ownsSource).toHaveBeenCalledWith("u1", edit.inputUrl);
    expect(jobs.createJob).not.toHaveBeenCalled();
    expect(f).not.toHaveBeenCalled();
  });
  it("sends the clip to the edit model as video_url", async () => {
    env.FAL_KEY = "k"; env.FAL_EDIT_VIDEO_MODEL = "fal-ai/editor/v2v";
    jobs.createJob.mockResolvedValueOnce(job({ kind: "edit_video", prompt: edit.prompt, inputUrl: edit.inputUrl }));
    const f = vi.fn(async () => reply({ status_url: "https://queue.fal.run/a/requests/1/status", response_url: "https://queue.fal.run/a/requests/1" }));
    await startJob("u1", edit, f as unknown as typeof fetch);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://queue.fal.run/fal-ai/editor/v2v");
    expect(JSON.parse(String(init.body))).toEqual({ prompt: "make it night", video_url: edit.inputUrl });
  });
  it("deletes the source clip when the provider rejects the job", async () => {
    env.FAL_KEY = "k";
    jobs.createJob.mockResolvedValueOnce(job({ kind: "edit_video" }));
    await startJob("u1", edit, (async () => reply({}, 500)) as unknown as typeof fetch);
    expect(uploads.releaseSource).toHaveBeenCalledWith(ID);
  });
  it("deletes the source clip once the job completes, and again when a finished job is polled", async () => {
    env.FAL_KEY = "k";
    jobs.jobRef.mockResolvedValue(REF);
    jobs.getJob.mockResolvedValue(job({ provider: "fal", kind: "edit_video", status: "completed" }));
    const f = vi.fn(async (url: string) => (url.endsWith("/status") ? reply({ status: "COMPLETED" }) : reply({ video: { url: "https://v3.fal.media/o.mp4" } })));
    await refreshJob("u1", job({ provider: "fal", kind: "edit_video" }) as never, f as unknown as typeof fetch, 1_005_000);
    expect(uploads.releaseSource).toHaveBeenCalledWith(ID);
    uploads.releaseSource.mockClear();
    await refreshJob("u1", job({ provider: "fal", kind: "edit_video", status: "completed" }) as never);
    expect(uploads.releaseSource).toHaveBeenCalledWith(ID);
  });
  it("does not touch uploads for Create Video jobs", async () => {
    jobs.getJob.mockResolvedValue(job({ status: "completed" }));
    await refreshJob("u1", job({ status: "completed" }) as never);
    expect(uploads.releaseSource).not.toHaveBeenCalled();
  });
});

describe("refreshJob", () => {
  it("keeps a young simulated job processing, then completes it with the sample clip", async () => {
    jobs.getJob.mockResolvedValue(job());
    await refreshJob("u1", job() as never, fetch, 1_000_000 + (SIM_SECONDS - 1) * 1000);
    expect(jobs.finishJob).not.toHaveBeenCalled();
    await refreshJob("u1", job() as never, fetch, 1_000_000 + SIM_SECONDS * 1000);
    expect(jobs.finishJob).toHaveBeenCalledWith(ID, { status: "completed", videoUrl: expect.stringMatching(/^https:\/\//) });
  });
  it("leaves finished jobs alone", async () => {
    const done = job({ status: "completed" });
    expect(await refreshJob("u1", done as never)).toBe(done);
    expect(jobs.getJob).not.toHaveBeenCalled();
  });
  it("completes a Fal job once the queue reports COMPLETED and a video URL is returned", async () => {
    env.FAL_KEY = "k";
    jobs.jobRef.mockResolvedValue(REF); jobs.getJob.mockResolvedValue(job({ provider: "fal" }));
    const f = vi.fn(async (url: string) => (url.endsWith("/status") ? reply({ status: "COMPLETED" }) : reply({ video: { url: "https://v3.fal.media/out.mp4" } })));
    await refreshJob("u1", job({ provider: "fal" }) as never, f as unknown as typeof fetch, 1_000_000 + 5000);
    expect(jobs.finishJob).toHaveBeenCalledWith(ID, { status: "completed", videoUrl: "https://v3.fal.media/out.mp4" });
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ Authorization: "Key k" });
  });
  it("keeps waiting while queued, and survives network errors and server errors", async () => {
    env.FAL_KEY = "k";
    jobs.jobRef.mockResolvedValue(REF); jobs.getJob.mockResolvedValue(job({ provider: "fal" }));
    await refreshJob("u1", job({ provider: "fal" }) as never, (async () => reply({ status: "IN_PROGRESS" })) as unknown as typeof fetch, 1_005_000);
    await refreshJob("u1", job({ provider: "fal" }) as never, (async () => { throw new Error("net"); }) as unknown as typeof fetch, 1_005_000);
    await refreshJob("u1", job({ provider: "fal" }) as never, (async () => reply({}, 503)) as unknown as typeof fetch, 1_005_000);
    expect(jobs.finishJob).not.toHaveBeenCalled();
    expect(jobs.failJob).not.toHaveBeenCalled();
  });
  it("fails a job Fal no longer knows, a finished job with no video, and a job stuck for 30 minutes", async () => {
    env.FAL_KEY = "k";
    jobs.jobRef.mockResolvedValue(REF); jobs.getJob.mockResolvedValue(job({ provider: "fal" }));
    await refreshJob("u1", job({ provider: "fal" }) as never, (async () => reply({}, 404)) as unknown as typeof fetch, 1_005_000);
    expect(jobs.failJob).toHaveBeenCalledTimes(1);
    const f = vi.fn(async (url: string) => (url.endsWith("/status") ? reply({ status: "COMPLETED" }) : reply({})));
    await refreshJob("u1", job({ provider: "fal" }) as never, f as unknown as typeof fetch, 1_005_000);
    expect(jobs.finishJob).toHaveBeenCalledWith(ID, { status: "failed", videoUrl: null });
    await refreshJob("u1", job({ provider: "fal" }) as never, (async () => reply({ status: "IN_QUEUE" })) as unknown as typeof fetch, 1_000_000 + 31 * 60 * 1000);
    expect(jobs.failJob).toHaveBeenCalledTimes(2);
  });
  it("never sends the key to a stored URL that is not Fal's queue", async () => {
    env.FAL_KEY = "k";
    jobs.jobRef.mockResolvedValue(JSON.stringify({ statusUrl: "https://evil.example/s", responseUrl: "https://evil.example/r" })); jobs.getJob.mockResolvedValue(job({ provider: "fal" }));
    const f = vi.fn();
    await refreshJob("u1", job({ provider: "fal" }) as never, f as unknown as typeof fetch, 1_005_000);
    expect(f).not.toHaveBeenCalled();
    expect(jobs.failJob).toHaveBeenCalled();
  });
});
