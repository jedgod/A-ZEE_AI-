import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToString } from "react-dom/server";

vi.mock("@/lib/admin/host-auth", () => ({
  requireHostActor: vi.fn(async () => ({
    userId: "11111111-1111-1111-1111-111111111111",
    tenantId: "22222222-2222-2222-2222-222222222222",
    role: "owner",
    platform: true,
    sessionId: "33333333-3333-3333-3333-333333333333",
  })),
}));

import AdminLayout from "@/app/admin/layout";

describe("admin layout", () => {
  it("renders navigation and tenant metadata", async () => {
    const html = renderToString(
      await AdminLayout({
        children: <div>Child content</div>,
      })
    );

    expect(html).toContain("AZ_AI / Admin");
    expect(html).toContain("Tenant:");
    expect(html).toContain("Role:");
    expect(html).toContain("dashboard");
    expect(html).toContain("users");
    expect(html).toContain("Child content");
  });
});
