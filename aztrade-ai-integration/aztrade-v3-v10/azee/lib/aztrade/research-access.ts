import 'server-only';
import { requireUser, allow } from '@/lib/users/auth';
import { accessFor } from '@/lib/plans';
import { webActor } from '@/lib/pipeline/actor';

export async function researchAccess(request: Request) {
  const user=await requireUser(request,true);
  if(!await allow('aztrade-research',user.id,15))throw new Error('RATE_LIMITED');
  const {actor}=webActor(request,{id:user.id,name:user.name,email:user.email,verified:true});
  const access=await accessFor(actor);
  if(access.walled)throw new Error('SUBSCRIPTION_REQUIRED');
  // This is a conservative launch policy, not a replacement for billing-managed entitlements.
  const limits:Record<string,number>={free:5,go:10,plus:30,pro:100,business:200,enterprise:500};
  return {user,actor,access,limit:limits[access.planId]??0};
}
