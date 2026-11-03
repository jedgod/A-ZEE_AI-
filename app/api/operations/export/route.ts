import { exportCsv } from "@/lib/support/complaints";
import { errorResponse, requireStaff } from "@/lib/staff/route";

export const runtime = "nodejs";

export async function GET() {
  try {
    const admin = await requireStaff(undefined, ["admin"]);
    return new Response(await exportCsv(admin), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="complaints-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) { return errorResponse(error); }
}
