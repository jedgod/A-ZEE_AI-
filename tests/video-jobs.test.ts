import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ query: vi.fn(async (..._a: unknown[]) => ({ rows: [] as any[], rowCount: 0 })) }));
vi.mock("@/lib/admin/db", () => ({ pool: db }));

import { createJob, finishJob, getJob, JobLimitError, MAX_ACTIVE_JOBS, normalizeWebhook, secretMatches } from "@/lib/video-jobs";

const ID = "3f0c9a52-1b7e-4d3a-9c55-0a1b2c3d4e5f";
beforeEach(() => db.query.mockClear());

describe("normalizeWebhook", () => {
  it("reads Fal.ai results", () => expect(normalizeWebhook({ status: "OK", payload: { video: { url: "https://cdn.example/v.mp4" } } })).toEqual({ status: "completed", videoUrl: "https://cdn.example/v.mp4" }));
  it("reads Runway results (first output)", () => expect(normalizeWebhook({ status: "SUCCEEDED", output: ["https://cdn.example/a.mp4", "https://cdn.example/b.mp4"] })).toEqual({ status: "completed", videoUrl: "https://cdn.example/a.mp4" }));
  it("fails a finished job with no usable https URL", () => {
    expect(normalizeWebhook({ status: "OK", payload: {} }).status).toBe("failed");
    expect(normalizeWebhook({ status: "SUCCEEDED", output: ["http://insecure/v.mp4"] }).status).toBe("failed");
    expect(normalizeWebhook({ status: "SUCCEEDED", output: ["javascript:alert(1)"] }).status).toBe("failed");
  });
  it("fails unknown statuses and junk bodies", () => {
    expect(normalizeWebhook({ status: "FAILED" }).status).toBe("failed");
    expect(normalizeWebhook(null).status).toBe("failed");
  });
});

describe("secretMatches", () => {
  it("fails closed without a configured secret", () => expect(secretMatches("x", undefined)).toBe(false));
  it("compares exactly", () => {
    expect(secretMatches("s3cret", "s3cret")).toBe(true);
    expect(secretMatches("s3cre", "s3cret")).toBe(false);
    expect(secretMatches(null, "s3cret")).toBe(false);
  });
});

describe("createJob", () => {
  it("refuses a new job when the account already has the maximum processing", async () => {
    db.query.mockResolvedValueOnce({ rows: [{ n: MAX_ACTIVE_JOBS }], rowCount: 1 });
    await expect(createJob("u1", { kind: "create_video", prompt: "a drone shot" })).rejects.toBeInstanceOf(JobLimitError);
    expect(db.query).toHaveBeenCalledTimes(1); // no INSERT
  });
  it("inserts for the owner when under the limit", async () => {
    db.query.mockResolvedValueOnce({ rows: [{ n: 0 }], rowCount: 1 }).mockResolvedValueOnce({ rows: [{ id: ID }], rowCount: 1 });
    expect((await createJob("u1", { kind: "create_video", prompt: "  a drone shot " })).id).toBe(ID);
    expect(db.query.mock.calls[1][1]).toEqual(["u1", "create_video", "a drone shot", null]);
  });
  it("rejects http input URLs and empty prompts", async () => {
    await expect(createJob("u1", { kind: "edit_video", prompt: "x", inputUrl: "http://insecure/v.mp4" })).rejects.toThrow();
    await expect(createJob("u1", { kind: "create_video", prompt: "   " })).rejects.toThrow();
  });
});

describe("jobs", () => {
  it("only finishes jobs that are still processing", async () => {
    db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect(await finishJob(ID, { status: "completed", videoUrl: "https://x/v.mp4" })).toBe("ignored");
    expect(String(db.query.mock.calls[0][0])).toContain("status = 'processing'");
  });
  it("scopes reads to the owner and rejects non-UUID ids without querying", async () => {
    expect(await getJob("u1", "not-a-uuid")).toBeNull();
    expect(db.query).not.toHaveBeenCalled();
    await getJob("u1", ID);
    expect(db.query.mock.calls[0][1]).toEqual([ID, "u1"]);
  });
});
