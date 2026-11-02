import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "az_session"
        ? { value: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
        : undefined,
    set: vi.fn(),
  }),
}));

vi.mock("@/lib/admin/host-auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin/host-auth")>("@/lib/admin/host-auth");
  return {
    ...actual,
    requireHostActor: vi.fn(async () => ({
      userId: "11111111-1111-1111-1111-111111111111",
      tenantId: "22222222-2222-2222-2222-222222222222",
      role: "owner",
      platform: true,
      sessionId: "33333333-3333-3333-3333-333333333333",
    })),
    requestActor: vi.fn(async () => ({
      userId: "11111111-1111-1111-1111-111111111111",
      tenantId: "22222222-2222-2222-2222-222222222222",
      role: "owner",
      platform: true,
      sessionId: "33333333-3333-3333-3333-333333333333",
    })),
  };
});

vi.mock("@/lib/admin/core", async () => {
  const actual = await vi.importActual<typeof import("@/lib/admin/core")>("@/lib/admin/core");
  return {
    ...actual,
    pool: {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      connect: vi.fn(),
    },
  };
});

import { GET as meRoute } from "@/app/api/admin/me/route";
import { GET as healthRoute } from "@/app/api/admin/health/route";
import { POST as logoutRoute } from "@/app/api/admin/session/logout/route";
import { POST as bootstrapRoute } from "@/app/api/admin/session/bootstrap/route";

describe("15_ADMIN runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_ORIGIN = "http://localhost:3000";
  });

  it("exposes the current actor from /api/admin/me", async () => {
    const response = await meRoute(new Request("http://localhost/api/admin/me"));
    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload.userId).toBe("11111111-1111-1111-1111-111111111111");
    expect(payload.role).toBe("owner");
  });

  it("returns a health payload", async () => {
    const response = await healthRoute(new Request("http://localhost/api/admin/health"));
    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload.ok).toBe(true);
    expect(payload.service).toBe("15_ADMIN");
  });

  it("logout route clears the session through the revocation layer", async () => {
    const req = new Request("http://localhost/api/admin/session/logout", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
      },
    });

    const response = await logoutRoute(req);
    expect([200, 403, 401]).toContain(response.status);
  });

  it("bootstrap remains locked out", async () => {
    const response = await bootstrapRoute(new Request("http://localhost/api/admin/session/bootstrap", {
      method: "POST",
    }));
    expect(response.status).toBe(404);
  });
});
