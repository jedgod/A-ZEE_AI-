import { z } from "zod";
import { body } from "@/lib/sidebar-route";
import { verifyClaimsLive } from "@/lib/search/engine";
import { NO_STORE, searchRoute } from "@/lib/search/route";

export const runtime = "nodejs";
export const maxDuration = 120;

/** POST /api/v1/search/verify-claims { claims: string[] (1–5) }: each claim checked against fresh sources. */
export function POST(request: Request) {
  return searchRoute(request, true, async ({ owner, actor }) => {
    const { claims } = z.object({ claims: z.unknown() }).strict().parse(await body(request));
    return Response.json({ data: await verifyClaimsLive(owner, actor, claims) }, { headers: NO_STORE });
  });
}
