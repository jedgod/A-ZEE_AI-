import { z } from "zod";
import { readJson } from "@/lib/http";
import { getComplaint, transition } from "@/lib/support/complaints";
import { errorResponse, NO_STORE, requireStaff, uuid } from "@/lib/staff/route";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const staff = await requireStaff();
    return Response.json({ data: await getComplaint(staff, uuid.parse((await params).id)) }, { headers: NO_STORE });
  } catch (error) { return errorResponse(error); }
}

const action = z.object({
  action: z.enum(["assign", "submit", "approve", "return", "reprioritize", "reopen"]),
  version: z.number().int().positive(),
  assigneeId: uuid.optional(),
  resolution: z.string().max(5000).optional(),
  note: z.string().max(2000).optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
}).strict();

/** Workflow actions; authorization and the allowed transition are checked inside a transaction. */
export async function POST(request: Request, { params }: Params) {
  try {
    const staff = await requireStaff(request);
    const input = action.parse(await readJson(request, 20_000));
    const updated = await transition(staff, uuid.parse((await params).id), input.action, input);
    return Response.json({ data: updated }, { headers: NO_STORE });
  } catch (error) { return errorResponse(error); }
}
