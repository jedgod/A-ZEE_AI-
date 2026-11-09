import { requireUser, userFailure } from "@/lib/users/auth";
import { aiAllowance } from "@/lib/aztrade/ai";
import { tierForPlan } from "@/lib/linqext/policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET: who is signed in, their A-Zee plan and AZTrade tier, and this month's AZTrade AI allowance. Read live from A-Zee's own stores. */
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const a = await aiAllowance(user.id);
    return Response.json({ user: { id: user.id, name: user.name, email: user.email }, plan: a.plan, planName: a.planName, tier: tierForPlan(a.plan), allowance: { used: a.used, limit: a.limit } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return userFailure(error); }
}
