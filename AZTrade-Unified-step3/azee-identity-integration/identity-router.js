import { Router } from 'express';
import { importPKCS8, exportJWK, SignJWT, decodeProtectedHeader, jwtVerify } from 'jose';
import { randomUUID, timingSafeEqual, createPublicKey } from 'node:crypto';

const safeEqual = (a,b) => {const x=Buffer.from(String(a||'')), y=Buffer.from(String(b||'')); return x.length === y.length && timingSafeEqual(x,y);};
export function createAZTradeIdentityRouter({lookupLiveSession, lookupSubscription, issuer, audience, privateKeyPem, kid, serviceSecret, clock = () => new Date()}) {
  if (![lookupLiveSession,lookupSubscription].every(x=>typeof x==='function')) throw new Error('Live A-Zee session and subscription adapters required');
  if (!issuer || !audience || !privateKeyPem || !kid || !serviceSecret || serviceSecret.length<32) throw new Error('Issuer configuration incomplete');
  let keyPromise = importPKCS8(privateKeyPem, 'RS256');
  let publicKeyPromise = Promise.resolve(createPublicKey(privateKeyPem));
  const router=Router();
  router.get('/.well-known/jwks.json', async (_req,res)=>{
    try {const key=await publicKeyPromise; const jwk=await exportJWK(key); res.set('Cache-Control','public, max-age=60').json({keys:[{...jwk,kid,alg:'RS256',use:'sig'}]});}
    catch {res.status(503).json({error:'Key unavailable'});}
  });
  router.post('/token', async (req,res)=>{
    try {
      // Mount behind A-Zee's EXISTING authenticated session middleware. Never accept sid/sub from request body.
      const sid=req.session?.id, sub=req.session?.userId;
      if (!sid || !sub) return res.status(401).json({error:'Live login required'});
      const session=await lookupLiveSession(sid);
      if (!session || session.active !== true || session.userId !== sub || !session.tenantId) return res.status(401).json({error:'Session inactive'});
      const token=await new SignJWT({sid:String(sid)})
        .setProtectedHeader({alg:'RS256',kid,typ:'JWT'}).setIssuer(issuer).setAudience(audience)
        .setSubject(String(sub)).setJti(randomUUID()).setIssuedAt(Math.floor(clock().getTime()/1000))
        .setExpirationTime('5m').sign(await keyPromise);
      res.set('Cache-Control','no-store').json({access_token:token,token_type:'Bearer',expires_in:300});
    } catch {res.status(503).json({error:'Token mint unavailable'});}
  });
  router.post('/introspect', async (req,res)=>{
    if (!safeEqual(req.headers.authorization,`Bearer ${serviceSecret}`)) return res.status(401).json({active:false});
    try {
      const token=req.body?.token;
      if (typeof token !== 'string' || token.length > 8192) return res.status(400).json({active:false});
      const header=decodeProtectedHeader(token);
      if (header.alg!=='RS256' || header.kid!==kid) return res.json({active:false});
      const {payload}=await jwtVerify(token,await keyPromise,{issuer,audience,algorithms:['RS256'],maxTokenAge:'6m'});
      const session=await lookupLiveSession(payload.sid);
      if (!session || session.active!==true || String(session.userId)!==payload.sub || !session.tenantId) return res.json({active:false});
      const subscription=await lookupSubscription(payload.sub,session.tenantId);
      if (!subscription) return res.json({active:false});
      res.set('Cache-Control','no-store').json({active:true,session_active:true,sub:payload.sub,jti:payload.jti,sid:payload.sid,tenant_id:String(session.tenantId),plan:subscription.plan,subscription_status:subscription.status});
    } catch {res.json({active:false});}
  });
  return router;
}
