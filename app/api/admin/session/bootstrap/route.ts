export const runtime = "nodejs";

export async function POST() {
  return Response.json({ error: "NOT_FOUND" }, { status: 404 });
}
