import { z } from "zod";
import { readJson } from "@/lib/http";
import { changePassword } from "@/lib/staff/auth";
import { errorResponse, NO_STORE, rateLimit, requireStaff } from "@/lib/staff/route";

export const runtime = "nodejs";

const body = z.object({ current: z.string().min(1).max(200), next: z.string().min(1).max(200) }).strict();

export async function POST(request: Request) {
  try {
    const staff = await requireStaff(request, undefined, { allowPasswordChange: true });
    if (!await rateLimit("staff-password", staff.id, 10)) return Response.json({ error: "RATE_LIMITED" }, { status: 429, headers: NO_STORE });
    const input = body.parse(await readJson(request, 2_000));
    const problem = await changePassword(staff.id, input.current, input.next);
    if (problem) return Response.json({ error: "PASSWORD_REJECTED", message: problem }, { status: 422, headers: NO_STORE });
    return Response.json({ data: { changed: true } }, { headers: NO_STORE });
  } catch (error) { return errorResponse(error); }
}
