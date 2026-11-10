import { handleBridge } from "@/lib/aztrade/ai";

export const runtime = "nodejs";

/** POST: the AZTrade assistant's door to A-Zee's models. Service-to-service only (dedicated credential); see lib/aztrade/ai.ts. */
export async function POST(request: Request) {
  try { return await handleBridge(request); }
  catch (error) { console.error("aztrade ai bridge error", (error as Error).message); return Response.json({ error: "AI_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
