import { handleCheckoutEvent } from "@/lib/payments/checkout";
import { handleStripeEvent, type StripeEvent } from "@/lib/payments/methods";
import { verifyStripeSignature } from "@/lib/payments/stripe";

export const runtime = "nodejs";

const headers = { "Cache-Control": "no-store" };

/** Stripe events for saved payment methods and the charges made with them. The raw body's signature is checked before anything is parsed. */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "PAYMENTS_NOT_CONFIGURED" }, { status: 503, headers });
  const raw = await request.text();
  if (raw.length > 256_000) return Response.json({ error: "BODY_TOO_LARGE" }, { status: 413, headers });
  if (!verifyStripeSignature(request.headers.get("stripe-signature"), raw, secret)) {
    return Response.json({ error: "INVALID_SIGNATURE" }, { status: 400, headers });
  }
  try {
    const event = JSON.parse(raw) as StripeEvent;
    if (typeof event?.id !== "string" || typeof event?.type !== "string") return Response.json({ error: "INVALID_EVENT" }, { status: 422, headers });
    await handleStripeEvent(event);
    await handleCheckoutEvent(event);
    return Response.json({ received: true }, { headers });
  } catch (error) {
    if (error instanceof SyntaxError) return Response.json({ error: "INVALID_EVENT" }, { status: 422, headers });
    console.error("stripe webhook failed:", (error as Error).message);
    return Response.json({ error: "SERVICE_UNAVAILABLE" }, { status: 503, headers }); // Stripe retries
  }
}
