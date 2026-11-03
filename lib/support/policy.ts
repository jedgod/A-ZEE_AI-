// Complaint workflow rules. Pure functions: every server route calls `authorize` before a
// transition, and the database CHECK constraints (migration 007) back the same rules up.

export type OpsRole = "admin" | "staff" | "viewer";
export type Status = "open" | "in_progress" | "pending_review" | "resolved";
export type Action = "assign" | "submit" | "approve" | "return" | "reprioritize" | "reopen";

export type Actor = { id: string; tenantId: string; role: OpsRole };
export type ComplaintState = { tenantId: string; status: Status; assignedTo: string | null };

/** Admin membership roles map to operations roles. */
export function opsRole(membershipRole: string): OpsRole {
  if (membershipRole === "owner" || membershipRole === "admin") return "admin";
  if (membershipRole === "operator" || membershipRole === "reviewer") return "staff";
  return "viewer";
}

/** Who may see a complaint: admins and viewers see the tenant queue; staff see their own work. */
export function canView(actor: Actor, c: ComplaintState): boolean {
  if (actor.tenantId !== c.tenantId) return false;
  return actor.role !== "staff" || c.assignedTo === actor.id;
}

export function authorize(actor: Actor, c: ComplaintState, action: Action): boolean {
  if (actor.tenantId !== c.tenantId) return false;
  const admin = actor.role === "admin";
  const assignee = actor.role === "staff" && c.assignedTo === actor.id;
  switch (action) {
    // Admins route work: assigning an open complaint starts it; in-progress work can be reassigned.
    case "assign": return admin && (c.status === "open" || c.status === "in_progress");
    // Staff send their resolution for approval.
    case "submit": return (assignee || (admin && c.assignedTo === actor.id)) && c.status === "in_progress";
    // Only an administrator approves, and never their own submission.
    case "approve": return admin && c.status === "pending_review" && c.assignedTo !== actor.id;
    case "return": return admin && c.status === "pending_review";
    case "reprioritize": return admin && c.status !== "resolved";
    case "reopen": return admin && c.status === "resolved";
  }
}

/** The status a successful action leads to (null = unchanged). */
export function nextStatus(c: ComplaintState, action: Action): Status | null {
  switch (action) {
    case "assign": return c.status === "open" ? "in_progress" : null;
    case "submit": return "pending_review";
    case "approve": return "resolved";
    case "return": return "in_progress";
    case "reopen": return "in_progress";
    case "reprioritize": return null;
  }
}

export const STATUS_LABEL: Record<Status, string> = {
  open: "Open", in_progress: "In progress", pending_review: "In review", resolved: "Resolved",
};

export const displayNumber = (n: number | string) => `CMP-${n}`;
