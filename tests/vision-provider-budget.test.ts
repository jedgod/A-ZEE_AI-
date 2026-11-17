import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/admin/db", () => ({ pool: db, transaction: db.transaction }));
import { finishProviders, reserveProviders } from "@/lib/vision/provider-budget";
const consent = { googleGemini: false, sightengine: true, googleVision: true };
beforeEach(() => {
  db.query.mockReset(); db.transaction.mockReset();
  db.transaction.mockImplementation(async fn => fn(db));
});
describe("cross-worker image provider budget", () => {
  it("locks before checking and records exact per-image provider consent", async () => {
    db.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ recent: 0, active: 0, global_active: 0 }] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: "lease" }] });
    expect(await reserveProviders("owner", consent)).toBe("lease");
    expect(db.query.mock.calls[0][0]).toContain("pg_advisory_xact_lock");
    expect(db.query.mock.calls[2][0]).toContain("image_provider_usage");
    expect(db.query.mock.calls[3][1]).toEqual(["owner", JSON.stringify(consent)]);
  });
  it.each([{ recent: 0, active: 0, global_active: 0, global_recent: 200 }, { recent: 20, active: 0, global_active: 0 }, { recent: 0, active: 1, global_active: 1 }, { recent: 0, active: 0, global_active: 6 }])("refuses exceeded usage %j", async usage => {
    db.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [usage] });
    expect(await reserveProviders("owner", consent)).toBeNull();
    expect(db.query).toHaveBeenCalledTimes(2);
  });
  it("does not permit external work when the database fails", async () => {
    db.query.mockRejectedValue(new Error("database unavailable"));
    await expect(reserveProviders("owner", consent)).rejects.toThrow("database unavailable");
  });
  it("finishes or releases a failed lease without storing any image", async () => {
    db.query.mockResolvedValue({ rows: [] });
    await finishProviders("lease", "scan"); await finishProviders("failed");
    expect(db.query.mock.calls[0][1]).toEqual(["lease", "completed", "scan"]);
    expect(db.query.mock.calls[1][1]).toEqual(["failed", "failed", null]);
  });
});
