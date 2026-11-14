import { z } from "zod";
import { jsonBody, userRoute } from "@/lib/users/route";
import { createRule, listRules, MonitorError, RECURRENCES, RULE_CLASSES, RULE_TYPES } from "@/lib/finance/monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({ symbol: z.string().min(1).max(20), assetClass: z.enum(RULE_CLASSES), ruleType: z.enum(RULE_TYPES), threshold: z.number().positive().max(1e12), recurrence: z.enum(RECURRENCES).optional() }).strict();
const fail = (e: unknown) => { if (e instanceof MonitorError) return Response.json({ error: e.code }, { status: e.status, headers: { "Cache-Control": "no-store" } }); throw e; };

/** GET: this account's monitor rules and its latest alerts. POST: add a rule (at most 15 per account). */
export const GET = (request: Request) => userRoute(request, false, user => listRules(user.id));
export const POST = (request: Request) => userRoute(request, true, async user => {
  const input = body.safeParse(await jsonBody(request, 2_000));
  if (!input.success) return Response.json({ error: "INVALID_REQUEST" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  try { return { rule: await createRule(user.id, input.data) }; } catch (e) { return fail(e); }
}, 201);
