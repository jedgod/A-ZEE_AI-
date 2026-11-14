import { requireUser, userFailure } from '@/lib/users/auth';
import { lookupSubscription } from '@/lib/aztrade/identity';
import { companionCapabilities } from '@/lib/aztrade/companion-policy';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request) {
  try {
    if (process.env.AZTRADE_AI_COMPANION_ENABLED !== 'true') return Response.json({error:'FEATURE_DISABLED'},{status:503});
    const user=await requireUser(request);
    const subscription=await lookupSubscription(user.id);
    return Response.json({product:'AZTrade AI',plan:subscription.plan,tier:subscription.tier,capabilities:companionCapabilities(),disclaimer:'Research and education only; no orders can be placed.'},{headers:{'Cache-Control':'no-store'}});
  } catch(e){return userFailure(e);}
}
