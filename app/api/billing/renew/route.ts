import { purgeOldSignals } from "@/lib/abuse/signals";
import { cronAuthorized, renewDue } from "@/lib/payments/checkout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };

/**
 * POST (with `Authorization: Bearer $BILLING_CRON_SECRET`): charge every subscription whose period
 * has ended and end the ones set to cancel. Run it from a scheduler (daily or hourly is plenty);
 * running it twice is safe because each charge has an idempotency key per subscription and period.
 */
export async function POST(request: Request) {
  if (!process.env.BILLING_CRON_SECRET) return Response.json({ error: "BILLING_NOT_CONFIGURED" }, { status: 503, headers });
  if (!cronAuthorized(request.headers.get("authorization"))) return Response.json({ error: "UNAUTHORIZED" }, { status: 401, headers });
  try {
    const renewals = await renewDue();
    // Same scheduler run: abuse-prevention signals are deleted after 90 days.
    const purged = await purgeOldSignals().catch(() => 0);
    return Response.json({ data: { ...renewals, signalsPurged: purged } }, { headers });
  } catch (error) {
    console.error("renewal run failed:", (error as Error).message);
    return Response.json({ error: "SERVICE_UNAVAILABLE" }, { status: 503, headers });
  }
}
