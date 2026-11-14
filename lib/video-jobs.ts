import "server-only";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { pool } from "@/lib/admin/db";

// Background video jobs (migration 035). The provider (Fal.ai, Runway, ...) is called by whatever creates
// the job; this module owns the rows and the webhook that finishes them.

export const jobKind = z.enum(["create_video", "edit_video"]);
export const createJobInput = z.object({
  kind: jobKind,
  prompt: z.string().trim().min(1).max(4000),
  inputUrl: z.string().url().max(2048).startsWith("https://").optional(),
}).superRefine((v, ctx) => {
  if (v.kind === "edit_video" && !v.inputUrl) ctx.addIssue({ code: "custom", path: ["inputUrl"], message: "Edit Video needs the clip to edit" });
  if (v.kind === "create_video" && v.inputUrl) ctx.addIssue({ code: "custom", path: ["inputUrl"], message: "Create Video takes no source clip" });
});
export type MediaJob = { id: string; kind: "create_video" | "edit_video"; status: "processing" | "completed" | "failed"; provider: "simulated" | "fal"; prompt: string; inputUrl: string | null; outputUrl: string | null; createdAt: string };

const COLUMNS = `id, kind, status, provider, prompt, input_url AS "inputUrl", output_url AS "outputUrl", created_at AS "createdAt"`;
export const isJobId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

/** Jobs one account may have processing at once (a provider call costs money; a stuck job must not pile up). */
export const MAX_ACTIVE_JOBS = 3;
/** A job still processing after this long is treated as dead and no longer counts against the limit. */
const STALE_MINUTES = 30;

export class JobLimitError extends Error { constructor() { super("TOO_MANY_JOBS"); } }

export async function createJob(ownerId: string, input: z.input<typeof createJobInput>): Promise<MediaJob> {
  const v = createJobInput.parse(input);
  const active = await pool.query(`SELECT count(*)::int AS n FROM media_jobs WHERE owner_id = $1 AND status = 'processing' AND created_at > now() - make_interval(mins => $2)`, [ownerId, STALE_MINUTES]);
  if (active.rows[0].n >= MAX_ACTIVE_JOBS) throw new JobLimitError();
  const r = await pool.query(`INSERT INTO media_jobs (owner_id, kind, prompt, input_url) VALUES ($1, $2, $3, $4) RETURNING ${COLUMNS}`, [ownerId, v.kind, v.prompt, v.inputUrl ?? null]);
  return r.rows[0];
}

/** A job is only ever visible to the account that created it. */
export async function getJob(ownerId: string, id: string): Promise<MediaJob | null> {
  if (!isJobId(id)) return null;
  return (await pool.query(`SELECT ${COLUMNS} FROM media_jobs WHERE id = $1 AND owner_id = $2`, [id, ownerId])).rows[0] ?? null;
}

/** Constant-time comparison of the webhook secret. Fails closed when no secret is configured. */
export function secretMatches(provided: string | null | undefined, expected = process.env.VIDEO_WEBHOOK_SECRET): boolean {
  if (!expected || !provided) return false;
  const a = Buffer.from(provided), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type Outcome = { status: "completed" | "failed"; videoUrl: string | null };

export const httpsUrl = (v: unknown): string | null => (typeof v === "string" && v.length <= 2048 && /^https:\/\/[^\s]+$/.test(v) ? v : null);

/**
 * Normalizes the two payload shapes we accept.
 * Fal.ai:  { status: "OK" | "COMPLETED", payload: { video: { url } } }
 * Runway:  { status: "SUCCEEDED", output: ["https://..."] }
 * A finished status without a usable https video URL counts as failed, and so does any other status.
 */
export function normalizeWebhook(body: unknown): Outcome {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, any>;
  let url: string | null = null;
  if (b.status === "OK" || b.status === "COMPLETED") url = httpsUrl(b.payload?.video?.url) ?? httpsUrl(b.video?.url);
  else if (b.status === "SUCCEEDED") url = httpsUrl(Array.isArray(b.output) ? b.output[0] : b.output?.url);
  else return { status: "failed", videoUrl: null };
  return url ? { status: "completed", videoUrl: url } : { status: "failed", videoUrl: null };
}

/** Finishes a job exactly once: a repeated or late webhook cannot change a job that is no longer processing. */
export async function finishJob(id: string, outcome: Outcome): Promise<"updated" | "ignored"> {
  if (!isJobId(id)) return "ignored";
  const r = await pool.query(`UPDATE media_jobs SET status = $2, output_url = $3, updated_at = now() WHERE id = $1 AND status = 'processing'`, [id, outcome.status, outcome.videoUrl]);
  return r.rowCount ? "updated" : "ignored";
}

/** Records which engine handles a job, and (for Fal) the queue URLs used to poll it. Only while it is still processing. */
export async function setProvider(id: string, provider: "simulated" | "fal", ref: string | null = null): Promise<void> {
  await pool.query(`UPDATE media_jobs SET provider = $2, provider_ref = $3, updated_at = now() WHERE id = $1 AND status = 'processing'`, [id, provider, ref]);
}

/** The raw provider reference for a job (server-side only; it is never sent to the app). */
export async function jobRef(id: string): Promise<string | null> {
  return (await pool.query(`SELECT provider_ref FROM media_jobs WHERE id = $1`, [id])).rows[0]?.provider_ref ?? null;
}

/** Real (paid) jobs this account started in the last 24 hours. */
export async function realJobsToday(ownerId: string): Promise<number> {
  return (await pool.query(`SELECT count(*)::int AS n FROM media_jobs WHERE owner_id = $1 AND provider = 'fal' AND created_at > now() - interval '24 hours'`, [ownerId])).rows[0].n;
}

/** Failed jobs and their reason are not stored; a failed job just says so. */
export async function failJob(id: string): Promise<void> { await finishJob(id, { status: "failed", videoUrl: null }); }
