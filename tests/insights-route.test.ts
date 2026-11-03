import { beforeEach, describe, expect, it, vi } from "vitest";

const staff = vi.hoisted(() => ({ current: null as null | { role: string; mustChangePassword: boolean } }));
vi.mock("@/lib/staff/auth", () => ({ currentStaff: async () => staff.current }));
vi.mock("@/lib/admin/db", () => ({ pool: { query: vi.fn(async () => ({ rows: [] })) } }));

import { GET } from "@/app/api/insights/route";
import { parseDays } from "@/lib/pipeline/insights";

const remote = (q = "") => new Request(`https://az.example.com/api/insights${q}`);
const local = (q = "") => new Request(`http://localhost:3000/api/insights${q}`, { headers: { host: "localhost:3000" } });

describe("GET /api/insights", () => {
  beforeEach(() => { staff.current = null; process.env.DATABASE_URL = "postgres://test"; });

  it("accepts only the 1, 7 and 30 day periods", () => {
    expect([1, 7, 30, "7"].map(parseDays)).toEqual([1, 7, 30, 7]);
    expect([0, 2, "30d", null, 365].map(parseDays)).toEqual([null, null, null, null, null]);
  });

  it("refuses remote visitors and non-admin staff", async () => {
    expect((await GET(remote())).status).toBe(403);
    staff.current = { role: "staff", mustChangePassword: false };
    expect((await GET(remote())).status).toBe(403);
    staff.current = { role: "admin", mustChangePassword: true };
    expect((await GET(remote())).status).toBe(403);
  });

  it("serves admins and the local user, and validates the period", async () => {
    staff.current = { role: "admin", mustChangePassword: false };
    const ok = await GET(remote("?days=7"));
    expect(ok.status).toBe(200);
    expect((await ok.json()).data).toMatchObject({ periodDays: 7, windowHours: 168, styles: [] });
    expect((await GET(local("?days=3"))).status).toBe(422);
    const file = await GET(local("?days=30&download=1"));
    expect(file.headers.get("content-disposition")).toMatch(/^attachment; filename="az-insights-30d-\d{4}-\d{2}-\d{2}\.json"$/);
  });
});
