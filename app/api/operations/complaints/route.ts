import { z } from "zod";
import { readJson } from "@/lib/http";
import { createComplaint, listComplaints } from "@/lib/support/complaints";
import { errorResponse, NO_STORE, requireStaff, uuid } from "@/lib/staff/route";

export const runtime = "nodejs";

export async function GET() {
  try {
    const staff = await requireStaff();
    return Response.json({ data: await listComplaints(staff) }, { headers: NO_STORE });
  } catch (error) { return errorResponse(error); }
}

const body = z.object({
  subject: z.string().trim().min(1).max(150),
  customerName: z.string().trim().min(1).max(100),
  customerContact: z.string().trim().email().max(254).optional().or(z.literal("").transform(() => undefined)),
  body: z.string().trim().min(1).max(5000),
  category: z.enum(["bug", "support", "feedback", "other"]).default("support"),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  assigneeId: uuid.optional(),
}).strict();

/** Staff log complaints received by phone, email, or in person. Only admins may assign on creation. */
export async function POST(request: Request) {
  try {
    const staff = await requireStaff(request, ["admin", "staff"]);
    const input = body.parse(await readJson(request, 20_000));
    const complaint = await createComplaint({
      tenantId: staff.tenantId, source: "staff", category: input.category, reporterRef: null,
      customerName: input.customerName, customerContact: input.customerContact ?? null, subject: input.subject, body: input.body,
      priority: input.priority, assignTo: staff.role === "admin" ? input.assigneeId ?? null : null,
      createdBy: { id: staff.id, label: staff.name },
    });
    return Response.json({ data: complaint }, { status: 201, headers: NO_STORE });
  } catch (error) { return errorResponse(error); }
}
