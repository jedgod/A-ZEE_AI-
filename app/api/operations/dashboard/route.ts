import { dashboard } from "@/lib/support/complaints";
import { errorResponse, NO_STORE, requireStaff } from "@/lib/staff/route";

export const runtime = "nodejs";

export async function GET() {
  try {
    const staff = await requireStaff();
    return Response.json({ data: { me: { id: staff.id, name: staff.name, role: staff.role }, ...(await dashboard(staff)) } }, { headers: NO_STORE });
  } catch (error) { return errorResponse(error); }
}
