import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ query: vi.fn(async (..._a: unknown[]) => ({ rows: [] as any[], rowCount: 0 })) }));
vi.mock("@/lib/admin/db", () => ({ pool: db }));

import { acceptUpload, MAX_OPEN_UPLOADS, MAX_VIDEO_BYTES, ownsSource, purgeStale, releaseSource, UploadError, type VideoStorage } from "@/lib/video-upload";

const env = process.env as Record<string, string | undefined>;
const JOB = "3f0c9a52-1b7e-4d3a-9c55-0a1b2c3d4e5f";

function storage(over: Partial<VideoStorage> = {}) {
  const removed: string[] = [];
  const s: VideoStorage = {
    configured: () => true,
    upload: vi.fn(async () => ({ url: "https://utfs.io/f/abc.mp4", key: "abc" })),
    remove: vi.fn(async (key: string) => { removed.push(key); }),
    ...over,
  };
  return { s, removed };
}
const clip = (over: { type?: string; size?: number; name?: string } = {}) => {
  const f = new File([new Uint8Array(4)], over.name ?? "holiday.mp4", { type: over.type ?? "video/mp4" });
  Object.defineProperty(f, "size", { value: over.size ?? 1024 });
  return f as File & { name: string; type: string; size: number };
};
const reject = async (p: Promise<unknown>) => (await p.then(() => null, e => e)) as UploadError;

beforeEach(() => {
  db.query.mockReset(); db.query.mockResolvedValue({ rows: [{ n: 0 }], rowCount: 1 });
  delete env.AZ_PROVIDER_MODE;
});

describe("acceptUpload", () => {
  it("stores a valid clip and records it against the account", async () => {
    const { s } = storage();
    const r = await acceptUpload("u1", clip({ name: "C:\\clips\\holiday.mp4" }), s);
    expect(r).toEqual({ videoUrl: "https://utfs.io/f/abc.mp4", fileName: "holiday.mp4" });
    const insert = db.query.mock.calls.find(c => String(c[0]).includes("INSERT INTO video_uploads"))!;
    expect(insert[1]).toEqual(["abc", "u1", "https://utfs.io/f/abc.mp4", "holiday.mp4"]);
  });
  it("is refused in ollama-only mode before storage is touched", async () => {
    env.AZ_PROVIDER_MODE = "ollama-only";
    const { s } = storage();
    expect(await reject(acceptUpload("u1", clip(), s))).toMatchObject({ status: 403, code: "EXTERNAL_DATA_DISABLED" });
    expect(s.upload).not.toHaveBeenCalled();
  });
  it("reports missing storage configuration", async () => {
    expect(await reject(acceptUpload("u1", clip(), storage({ configured: () => false }).s))).toMatchObject({ status: 503, code: "STORAGE_NOT_CONFIGURED" });
  });
  it("accepts only MP4, MOV and WebM", async () => {
    for (const type of ["video/mp4", "video/quicktime", "video/webm"]) await acceptUpload("u1", clip({ type }), storage().s);
    for (const type of ["video/x-msvideo", "image/png", "application/pdf", ""]) expect(await reject(acceptUpload("u1", clip({ type }), storage().s))).toMatchObject({ status: 415, code: "UNSUPPORTED_VIDEO" });
  });
  it("enforces the 50 MB limit and rejects empty files", async () => {
    expect(await reject(acceptUpload("u1", clip({ size: MAX_VIDEO_BYTES + 1 }), storage().s))).toMatchObject({ status: 413, code: "VIDEO_TOO_LARGE" });
    await acceptUpload("u1", clip({ size: MAX_VIDEO_BYTES }), storage().s);
    expect(await reject(acceptUpload("u1", clip({ size: 0 }), storage().s))).toMatchObject({ status: 422, code: "EMPTY_FILE" });
  });
  it("limits how many clips an account can have waiting", async () => {
    db.query.mockImplementation(async (sql: unknown) => (String(sql).includes("count(*)") ? { rows: [{ n: MAX_OPEN_UPLOADS }], rowCount: 1 } : { rows: [], rowCount: 0 }));
    const { s } = storage();
    expect(await reject(acceptUpload("u1", clip(), s))).toMatchObject({ status: 429, code: "TOO_MANY_UPLOADS" });
    expect(s.upload).not.toHaveBeenCalled();
  });
  it("reports a storage failure without recording anything", async () => {
    const { s } = storage({ upload: vi.fn(async () => { throw new Error("boom"); }) });
    expect(await reject(acceptUpload("u1", clip(), s))).toMatchObject({ status: 502, code: "UPLOAD_FAILED" });
    expect(db.query.mock.calls.some(c => String(c[0]).includes("INSERT INTO video_uploads"))).toBe(false);
  });
});

describe("ownership and cleanup", () => {
  it("only lets an account use its own, not-yet-deleted clips", async () => {
    db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect(await ownsSource("u2", "https://utfs.io/f/abc.mp4")).toBe(false);
    const [sql, params] = db.query.mock.calls[0] as [string, string[]];
    expect(sql).toContain("owner_id = $1");
    expect(sql).toContain("deleted_at IS NULL");
    expect(params).toEqual(["u2", "https://utfs.io/f/abc.mp4"]);
  });
  it("deletes the source clip of a finished Edit Video job and marks it deleted", async () => {
    db.query.mockResolvedValueOnce({ rows: [{ file_key: "abc" }], rowCount: 1 });
    const { s, removed } = storage();
    await releaseSource(JOB, s);
    expect(removed).toEqual(["abc"]);
    const lookup = String(db.query.mock.calls[0][0]);
    expect(lookup).toContain("j.status <> 'processing'"); // never while the provider may still need it
    expect(lookup).toContain("j.owner_id");                // only that account's own upload
    expect(String(db.query.mock.calls[1][0])).toContain("SET deleted_at");
  });
  it("keeps the record for a retry when storage cannot delete the file", async () => {
    db.query.mockResolvedValueOnce({ rows: [{ file_key: "abc" }], rowCount: 1 });
    await releaseSource(JOB, storage({ remove: vi.fn(async () => { throw new Error("down"); }) }).s);
    expect(db.query).toHaveBeenCalledTimes(1); // no UPDATE
  });
  it("does nothing without storage configured, and purges old clips", async () => {
    await releaseSource(JOB, storage({ configured: () => false }).s);
    expect(db.query).not.toHaveBeenCalled();
    db.query.mockResolvedValueOnce({ rows: [{ file_key: "old1" }, { file_key: "old2" }], rowCount: 2 });
    const { s, removed } = storage();
    await purgeStale(s);
    expect(removed).toEqual(["old1", "old2"]);
  });
});
