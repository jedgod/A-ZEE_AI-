import { describe, it, expect } from "vitest";
import { parsePayload } from "@/lib/admin/contracts";

describe("admin schemas", () => {
  it("validates user payloads", () => {
    const payload = parsePayload("users", {
      userId: "11111111-1111-4111-8111-111111111111",
      role: "viewer",
      status: "active",
      displayName: "Test User",
    });

    expect(payload.displayName).toBe("Test User");
    expect(payload.role).toBe("viewer");
  });

  it("rejects invalid approval payloads", () => {
    expect(() =>
      parsePayload("approvals", {
        resourceId: "not-a-uuid",
        resourceRevision: 1,
        requestedBy: "11111111-1111-1111-1111-111111111111",
        reason: "Required review",
      })
    ).toThrow();
  });
});
