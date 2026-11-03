import { z } from "zod";
import { runAuditTrail } from "@/14_OBSERVABILITY/audit_trail/module";
import { readJson } from "@/lib/http";
import { OpsError, updateStaff } from "@/lib/support/complaints";
import { auditSink } from "@/lib/support/feedback";
import { errorResponse, NO_STORE, requireStaff, uuid } from "@/lib/staff/route";

export const runtime = "nodejs";

const body = z.object({
  role: z.enum(["admin", "operator", "reviewer", "viewer"]).optional(),
  status: z.enum(["active", "suspended"]).optional(),
  resetPassword: z.boolean().optional(),
}).strict();

/** Change a team member's access. Every attempt, allowed or denied, goes to the 14 audit trail. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const staff = await requireStaff(request);
    const target = uuid.parse((await params).id);
    const audit = (outcome: "allowed" | "denied") =>
      runAuditTrail({ userId: staff.id, tenantId: staff.tenantId }, { action: "policy_change", resourceId: target, outcome }, auditSink(staff.name));
    if (staff.role !== "admin") {
      await audit("denied");
      throw new OpsError(403, "ROLE_NOT_ALLOWED");
    }
    try {
      const result = await updateStaff(staff, target, body.parse(await readJson(request, 2_000)));
      await audit("allowed");
      return Response.json({ data: result }, { headers: NO_STORE });
    } catch (error) {
      if (error instanceof OpsError && error.status === 422) await audit("denied");
      throw error;
    }
  } catch (error) { return errorResponse(error); }
}
