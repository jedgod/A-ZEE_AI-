import { z } from "zod";
import { readJson } from "@/lib/http";
import { createStaff, listStaff } from "@/lib/support/complaints";
import { errorResponse, NO_STORE, requireStaff } from "@/lib/staff/route";

export const runtime = "nodejs";

export async function GET() {
  try {
    const staff = await requireStaff();
    return Response.json({ data: await listStaff(staff.tenantId) }, { headers: NO_STORE });
  } catch (error) { return errorResponse(error); }
}

const body = z.object({
  email: z.string().trim().email().max(254),
  name: z.string().trim().min(1).max(100),
  role: z.enum(["admin", "operator", "reviewer", "viewer"]),
}).strict();

/** Admins add staff. The one-time temporary password is returned once, never stored in plain text. */
export async function POST(request: Request) {
  try {
    const admin = await requireStaff(request, ["admin"]);
    const result = await createStaff(admin, body.parse(await readJson(request, 4_000)));
    return Response.json({ data: result }, { status: 201, headers: NO_STORE });
  } catch (error) { return errorResponse(error); }
}
