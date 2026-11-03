import { z } from "zod";
import { readJson } from "@/lib/http";
import { listAnswerFeedback, queueForImprovement } from "@/lib/support/feedback";
import { errorResponse, NO_STORE, requireStaff, uuid } from "@/lib/staff/route";

export const runtime = "nodejs";

/** Answer feedback (13_FEEDBACK): unhelpful ratings and corrections, for administrators. */
export async function GET() {
  try {
    const admin = await requireStaff(undefined, ["admin"]);
    return Response.json({ data: await listAnswerFeedback(admin.tenantId) }, { headers: NO_STORE });
  } catch (error) { return errorResponse(error); }
}

const body = z.object({ requestId: uuid }).strict();

/** Queue an answer's feedback for review (13_FEEDBACK/improvement_queue). */
export async function POST(request: Request) {
  try {
    const admin = await requireStaff(request, ["admin"]);
    const { requestId } = body.parse(await readJson(request, 1_000));
    const result = await queueForImprovement({ userId: admin.id, tenantId: admin.tenantId, name: admin.name }, requestId);
    return Response.json({ data: result }, { status: 201, headers: NO_STORE });
  } catch (error) { return errorResponse(error); }
}
