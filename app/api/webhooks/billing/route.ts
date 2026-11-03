import { z } from "zod";
import { applyBillingEvent, BillingError, eventSchema, verifySignature } from "@/lib/billing";

export const runtime = "nodejs";

const headers = { "Cache-Control": "no-store" };

/** Payment provider events. The raw body is verified before it is parsed or trusted. */
export async function POST(request: Request) {
  const secret = process.env.BILLING_WEBHOOK_SECRET;
  if (!secret || secret.length < 32) return Response.json({ error: "BILLING_NOT_CONFIGURED" }, { status: 503, headers });
  const raw = await request.text();
  if (raw.length > 64_000) return Response.json({ error: "BODY_TOO_LARGE" }, { status: 413, headers });
  if (!verifySignature(request.headers.get("x-billing-signature"), raw, secret)) {
    return Response.json({ error: "INVALID_SIGNATURE" }, { status: 400, headers });
  }
  try {
    const applied = await applyBillingEvent(eventSchema.parse(JSON.parse(raw)));
    return Response.json({ received: true, duplicate: !applied }, { headers });
  } catch (error) {
    if (error instanceof BillingError) return Response.json({ error: error.code }, { status: error.status, headers });
    if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ error: "INVALID_EVENT" }, { status: 422, headers });
    console.error("billing webhook failed:", (error as Error).message);
    // 5xx tells the provider to retry; the event id makes retries safe.
    return Response.json({ error: "SERVICE_UNAVAILABLE" }, { status: 503, headers });
  }
}
