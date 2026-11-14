import "server-only";
import { pool } from "@/lib/admin/db";
import { ollamaOnly } from "@/lib/pipeline/privacy";

// Source clips for Edit Video. A clip is hosted temporarily (UploadThing) so the video provider can fetch it.
// It is recorded against the account that uploaded it; a job may only use that account's own uploads, and the
// clip is deleted as soon as the job finishes. Never available in ollama-only privacy mode.

export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
export const MAX_OPEN_UPLOADS = 3;
const STALE_HOURS = 6; // a clip nobody used is removed after this long

export class UploadError extends Error { constructor(public status: number, public code: string) { super(code); } }

/** The few storage calls we need; the real one is UploadThing, tests use a fake. */
export interface VideoStorage {
  configured(): boolean;
  upload(file: File): Promise<{ url: string; key: string }>;
  remove(key: string): Promise<void>;
}

export const uploadThingStorage: VideoStorage = {
  configured: () => Boolean(process.env.UPLOADTHING_TOKEN?.trim()),
  async upload(file) {
    const { UTApi } = await import("uploadthing/server");
    const res = await new UTApi().uploadFiles(file);
    if (res.error || !res.data) throw new Error("upload failed");
    const url = res.data.ufsUrl || res.data.url;
    if (!/^https:\/\//.test(url)) throw new Error("storage returned a non-https URL");
    return { url, key: res.data.key };
  },
  async remove(key) {
    const { UTApi } = await import("uploadthing/server");
    await new UTApi().deleteFiles(key);
  },
};

/** Validates and stores a clip for the account. Throws UploadError with the HTTP status to return. */
export async function acceptUpload(ownerId: string, file: { name: string; type: string; size: number } & File, storage: VideoStorage = uploadThingStorage) {
  if (ollamaOnly()) throw new UploadError(403, "EXTERNAL_DATA_DISABLED"); // clips never leave the machine in private mode
  if (!storage.configured()) throw new UploadError(503, "STORAGE_NOT_CONFIGURED");
  if (!VIDEO_TYPES.includes(file.type)) throw new UploadError(415, "UNSUPPORTED_VIDEO");
  if (file.size <= 0) throw new UploadError(422, "EMPTY_FILE");
  if (file.size > MAX_VIDEO_BYTES) throw new UploadError(413, "VIDEO_TOO_LARGE");
  await purgeStale(storage);
  const open = (await pool.query(`SELECT count(*)::int AS n FROM video_uploads WHERE owner_id = $1 AND deleted_at IS NULL`, [ownerId])).rows[0].n;
  if (open >= MAX_OPEN_UPLOADS) throw new UploadError(429, "TOO_MANY_UPLOADS");
  let stored: { url: string; key: string };
  try { stored = await storage.upload(file); } catch (error) { console.warn("video upload failed:", (error as Error).message.slice(0, 200)); throw new UploadError(502, "UPLOAD_FAILED"); }
  const name = file.name.split(/[\\/]/).pop()?.replace(/[\r\n\u0000-\u001f]+/g, " ").trim().slice(0, 200) || "clip";
  await pool.query(`INSERT INTO video_uploads (file_key, owner_id, url, file_name) VALUES ($1, $2, $3, $4)`, [stored.key, ownerId, stored.url, name]);
  return { videoUrl: stored.url, fileName: name };
}

/** True when this URL is a clip this account uploaded and has not yet been cleaned up. Jobs accept no other source. */
export async function ownsSource(ownerId: string, url: string): Promise<boolean> {
  return (await pool.query(`SELECT 1 FROM video_uploads WHERE owner_id = $1 AND url = $2 AND deleted_at IS NULL`, [ownerId, url])).rowCount === 1;
}

async function removeRow(key: string, storage: VideoStorage): Promise<void> {
  try { await storage.remove(key); } catch (error) { console.warn("video source delete failed:", (error as Error).message.slice(0, 200)); return; } // keep the row so it is retried
  await pool.query(`UPDATE video_uploads SET deleted_at = now() WHERE file_key = $1`, [key]);
}

/** Deletes the source clip of a finished Edit Video job. Safe to call any number of times. */
export async function releaseSource(jobId: string, storage: VideoStorage = uploadThingStorage): Promise<void> {
  if (!storage.configured()) return;
  const r = await pool.query(
    `SELECT u.file_key FROM media_jobs j JOIN video_uploads u ON u.owner_id = j.owner_id AND u.url = j.input_url
     WHERE j.id = $1 AND j.kind = 'edit_video' AND j.status <> 'processing' AND u.deleted_at IS NULL`, [jobId]);
  for (const row of r.rows) await removeRow(row.file_key, storage);
}

/** Removes clips older than a few hours that were never cleaned up (the app closed, the job was never started). */
export async function purgeStale(storage: VideoStorage = uploadThingStorage): Promise<void> {
  if (!storage.configured()) return;
  const r = await pool.query(`SELECT file_key FROM video_uploads WHERE deleted_at IS NULL AND created_at < now() - make_interval(hours => $1) LIMIT 20`, [STALE_HOURS]);
  for (const row of r.rows) await removeRow(row.file_key, storage);
}
