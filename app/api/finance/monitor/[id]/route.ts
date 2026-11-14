import { z } from "zod";
import { jsonBody, userRoute } from "@/lib/users/route";
import { deleteRule, MonitorError, RECURRENCES, RULE_TYPES, setRuleStatus, updateRule } from "@/lib/finance/monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();
// Either change the status (pause / re-arm) or edit the rule's condition; never both at once.
const body = z.union([
  z.object({ status: z.enum(["active", "paused"]) }).strict(),
  z.object({ ruleType: z.enum(RULE_TYPES).optional(), threshold: z.number().positive().max(1e12).optional(), recurrence: z.enum(RECURRENCES).optional() }).strict().refine(v => Object.keys(v).length > 0),
]);
const bad = (code: string, status = 400) => Response.json({ error: code }, { status, headers: { "Cache-Control": "no-store" } });
const fail = (e: unknown) => { if (e instanceof MonitorError) return bad(e.code, e.status); throw e; };

/** PATCH { status: "active" | "paused" } pauses or re-arms a rule; PATCH { ruleType?, threshold?, recurrence? } edits it. DELETE removes it. Both only ever touch the caller's own rules. */
export const PATCH = (request: Request, ctx: { params: Promise<{ id: string }> }) => userRoute(request, true, async user => {
  const id = idSchema.safeParse((await ctx.params).id);
  const input = body.safeParse(await jsonBody(request, 500));
  if (!id.success || !input.success) return bad("INVALID_REQUEST");
  try { return { rule: "status" in input.data ? await setRuleStatus(user.id, id.data, input.data.status) : await updateRule(user.id, id.data, input.data) }; } catch (e) { return fail(e); }
});
export const DELETE = (request: Request, ctx: { params: Promise<{ id: string }> }) => userRoute(request, true, async user => {
  const id = idSchema.safeParse((await ctx.params).id);
  if (!id.success) return bad("INVALID_REQUEST");
  try { return await deleteRule(user.id, id.data); } catch (e) { return fail(e); }
});
