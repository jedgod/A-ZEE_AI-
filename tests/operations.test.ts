import { describe, expect, it } from "vitest";
import { hashPassword, passwordProblem, temporaryPassword, verifyPassword } from "@/lib/staff/password";
import { authorize, canView, nextStatus, opsRole, type Action, type Actor, type ComplaintState } from "@/lib/support/policy";

const T = "tenant-1";
const admin: Actor = { id: "admin-1", tenantId: T, role: "admin" };
const admin2: Actor = { id: "admin-2", tenantId: T, role: "admin" };
const staff: Actor = { id: "staff-1", tenantId: T, role: "staff" };
const other: Actor = { id: "staff-2", tenantId: T, role: "staff" };
const viewer: Actor = { id: "viewer-1", tenantId: T, role: "viewer" };
const outsider: Actor = { id: "admin-x", tenantId: "tenant-2", role: "admin" };
const c = (status: ComplaintState["status"], assignedTo: string | null = null): ComplaintState => ({ tenantId: T, status, assignedTo });

describe("complaint workflow policy", () => {
  it("maps membership roles to operations roles", () => {
    expect(["owner", "admin", "operator", "reviewer", "viewer", "x"].map(opsRole)).toEqual(["admin", "admin", "staff", "staff", "viewer", "viewer"]);
  });

  it("lets only admins assign, and only before resolution", () => {
    expect(authorize(admin, c("open"), "assign")).toBe(true);
    expect(authorize(admin, c("in_progress", "staff-1"), "assign")).toBe(true);
    expect(authorize(admin, c("pending_review", "staff-1"), "assign")).toBe(false);
    expect(authorize(staff, c("open"), "assign")).toBe(false);
    expect(authorize(viewer, c("open"), "assign")).toBe(false);
    expect(nextStatus(c("open"), "assign")).toBe("in_progress");
    expect(nextStatus(c("in_progress", "staff-1"), "assign")).toBeNull();
  });

  it("lets only the assigned person submit a resolution", () => {
    expect(authorize(staff, c("in_progress", "staff-1"), "submit")).toBe(true);
    expect(authorize(other, c("in_progress", "staff-1"), "submit")).toBe(false);
    expect(authorize(admin, c("in_progress", "staff-1"), "submit")).toBe(false);
    expect(authorize(admin, c("in_progress", "admin-1"), "submit")).toBe(true);
    expect(authorize(staff, c("open", "staff-1"), "submit")).toBe(false);
  });

  it("requires a different administrator to approve", () => {
    expect(authorize(admin, c("pending_review", "staff-1"), "approve")).toBe(true);
    expect(authorize(staff, c("pending_review", "staff-1"), "approve")).toBe(false);
    expect(authorize(admin, c("pending_review", "admin-1"), "approve")).toBe(false);
    expect(authorize(admin2, c("pending_review", "admin-1"), "approve")).toBe(true);
    expect(authorize(admin, c("in_progress", "staff-1"), "approve")).toBe(false);
  });

  it("never crosses tenants and scopes staff to their own work", () => {
    for (const action of ["assign", "submit", "approve", "return", "reprioritize", "reopen"] as Action[]) {
      expect(authorize(outsider, c("pending_review", "staff-1"), action)).toBe(false);
    }
    expect(canView(outsider, c("open"))).toBe(false);
    expect(canView(staff, c("in_progress", "staff-1"))).toBe(true);
    expect(canView(staff, c("in_progress", "staff-2"))).toBe(false);
    expect(canView(viewer, c("in_progress", "staff-2"))).toBe(true);
  });

  it("returns, reopens and reprioritizes only as an admin", () => {
    expect(authorize(admin, c("pending_review", "staff-1"), "return")).toBe(true);
    expect(nextStatus(c("pending_review", "staff-1"), "return")).toBe("in_progress");
    expect(authorize(admin, c("resolved", "staff-1"), "reopen")).toBe(true);
    expect(authorize(staff, c("resolved", "staff-1"), "reopen")).toBe(false);
    expect(authorize(admin, c("resolved", "staff-1"), "reprioritize")).toBe(false);
  });
});

describe("staff passwords", () => {
  it("hashes with scrypt and verifies in constant time", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("correct horse batterY", hash)).toBe(false);
    expect(await hashPassword("correct horse battery")).not.toBe(hash); // random salt
  });

  it("rejects malformed or abusive stored hashes", async () => {
    expect(await verifyPassword("x", "plain-text")).toBe(false);
    expect(await verifyPassword("x", "scrypt$1048577$8$1$AAAA$AAAA")).toBe(false);
  });

  it("enforces length and variety, and issues strong temporary passwords", () => {
    expect(passwordProblem("short")).toMatch(/12/);
    expect(passwordProblem("aaaaaaaaaaaaaaaa")).toMatch(/repetitive/);
    expect(passwordProblem("a long enough passphrase")).toBeNull();
    const temp = temporaryPassword();
    expect(temp).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(passwordProblem(temp)).toBeNull();
  });
});
