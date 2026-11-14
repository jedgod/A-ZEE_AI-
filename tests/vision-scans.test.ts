import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ query: vi.fn(async (..._a: unknown[]) => ({ rows: [] as any[], rowCount: 0 })) }));
vi.mock("@/lib/admin/db", () => ({ pool: db }));

import { clearScans, deleteScan } from "@/lib/vision/scans";

const ID = "3f0c9a52-1b7e-4d3a-9c55-0a1b2c3d4e5f";
beforeEach(() => db.query.mockClear());

describe("scan deletion", () => {
  it("deletes only the owner's scan", async () => {
    db.query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    expect(await deleteScan("u1", ID)).toBe(true);
    expect(db.query.mock.calls[0][1]).toEqual([ID, "u1"]);
  });
  it("reports false for someone else's or a missing scan, and skips the query for junk ids", async () => {
    db.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    expect(await deleteScan("u2", ID)).toBe(false);
    expect(await deleteScan("u1", "../../x")).toBe(false);
    expect(db.query).toHaveBeenCalledTimes(1);
  });
  it("clears only the owner's scans and returns the count", async () => {
    db.query.mockResolvedValueOnce({ rows: [], rowCount: 4 });
    expect(await clearScans("u1")).toBe(4);
    expect(db.query.mock.calls[0][1]).toEqual(["u1"]);
  });
});
