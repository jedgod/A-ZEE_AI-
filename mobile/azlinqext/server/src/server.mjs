import Fastify from 'fastify';
import pg from 'pg';
import {jwtVerify, createRemoteJWKSet} from 'jose';
import {z} from 'zod';
import {createHash, randomUUID} from 'node:crypto';
import {TIERS,effectiveTier,trimContext,buildInstructions} from './policy.mjs';

const env=['DATABASE_URL','AZEE_JWKS_URL','AZEE_JWT_ISSUER','AZEE_JWT_AUDIENCE','AZEE_INFERENCE_URL','AZEE_INFERENCE_TOKEN'];
if (process.env.NODE_ENV !== 'test') for(const name of env) if(!process.env[name]) throw new Error(`Missing ${name}`);
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:15,connectionTimeoutMillis:3000,statement_timeout:10000,ssl:process.env.PG_SSL==='true'?{rejectUnauthorized:true}:undefined});
const jwks=process.env.AZEE_JWKS_URL?createRemoteJWKSet(new URL(process.env.AZEE_JWKS_URL)):null;
const app=Fastify({logger:{redact:['req.headers.authorization','req.body.message','req.body.context','req.body.writingStyle']},bodyLimit:32768,requestTimeout:15000,trustProxy:false});
const requestSchema=z.object({
 requestId:z.string().uuid(), message:z.string().trim().min(1).max(4000),
 context:z.array(z.object({role:z.enum(['self','other']),text:z.string().max(2000)})).max(20).default([]),
 tone:z.enum(['casual','professional','concise','empathetic','friendly','custom']).default('professional'),
 customTone:z.string().max(120).optional(), variants:z.number().int().min(1).max(5).default(1),
 consent:z.literal(true)
}).strict();

app.addHook('onRequest',async(req,reply)=>{
 if(req.url==='/health/live') return;
 const authorization=req.headers.authorization||'';
 if(!authorization.startsWith('Bearer ')) return reply.code(401).send({error:'unauthorized'});
 try {
  const {payload}=await jwtVerify(authorization.slice(7),jwks,{issuer:process.env.AZEE_JWT_ISSUER,audience:process.env.AZEE_JWT_AUDIENCE,algorithms:['RS256','ES256']});
  if(typeof payload.sub!=='string'||!payload.sub) throw new Error('missing sub');
  req.userId=payload.sub;
 } catch {return reply.code(401).send({error:'unauthorized'});}
});
app.get('/health/live',async()=>({ok:true}));
app.get('/v1/entitlements',async(req)=>{
 const {rows}=await pool.query('SELECT tier,status,period_end FROM az_entitlements WHERE user_id=$1',[req.userId]);
 const tier=effectiveTier(rows[0]);return {tier,features:TIERS[tier]};
});

async function infer(message,context,tier,tone,customTone,variants,style){
 const instructions=buildInstructions(tier,tone)+(tone==='custom'?` Requested style: ${customTone||'neutral'}.`:'')+(style?` User-approved style preference: ${style.slice(0,400)}.`:'');
 const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),9000);
 try {
  const response=await fetch(process.env.AZEE_INFERENCE_URL,{method:'POST',signal:controller.signal,headers:{'authorization':`Bearer ${process.env.AZEE_INFERENCE_TOKEN}`,'content-type':'application/json'},body:JSON.stringify({task:'reply',instructions,message,context,variants,maxWords:TIERS[tier].maxWords,tier})});
  if(!response.ok) throw new Error('inference_unavailable');
  const data=await response.json();
  if(!Array.isArray(data.replies)||data.replies.length!==variants||data.replies.some(v=>typeof v!=='string'||!v.trim()||v.length>3000)) throw new Error('invalid_inference_response');
  return data.replies.map(v=>v.trim());
 }finally{clearTimeout(timeout);}
}
app.post('/v1/replies',async(req,reply)=>{
 const parsed=requestSchema.safeParse(req.body);
 if(!parsed.success) return reply.code(400).send({error:'invalid_request',details:parsed.error.flatten()});
 const input=parsed.data;
 const hash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
 const client=await pool.connect();let tier,context,style='';
 try {
  await client.query('BEGIN');
  // A transaction-scoped advisory lock serializes requests for this user, including entitlement updates when writers use the same lock.
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[req.userId]);
  const existing=await client.query('SELECT payload_hash,status,response FROM az_requests WHERE user_id=$1 AND request_id=$2',[req.userId,input.requestId]);
  if(existing.rowCount){
   await client.query('COMMIT');const row=existing.rows[0];
   if(row.payload_hash!==hash) return reply.code(409).send({error:'idempotency_conflict'});
   if(row.status==='completed') return reply.header('Idempotent-Replay','true').send(row.response);
   return reply.code(409).send({error:row.status==='running'?'request_in_progress':'previous_attempt_failed'});
  }
  const ent=await client.query('SELECT tier,status,period_end FROM az_entitlements WHERE user_id=$1',[req.userId]);
  tier=effectiveTier(ent.rows[0]);const policy=TIERS[tier];
  if(!policy.tones.includes(input.tone)||input.variants>policy.variants) {await client.query('ROLLBACK');return reply.code(403).send({error:'feature_not_in_plan',tier});}
  context=trimContext(input.context,tier);
  if(policy.personalized){const pref=await client.query('SELECT writing_style FROM az_preferences WHERE user_id=$1',[req.userId]);style=pref.rows[0]?.writing_style||'';}
  const period=new Date().toISOString().slice(0,7)+'-01';
  await client.query('INSERT INTO az_usage(user_id,period,used) VALUES($1,$2,0) ON CONFLICT DO NOTHING',[req.userId,period]);
  const usage=await client.query('UPDATE az_usage SET used=used+1 WHERE user_id=$1 AND period=$2 AND used<$3 RETURNING used',[req.userId,period,policy.limit]);
  if(!usage.rowCount){await client.query('ROLLBACK');return reply.code(429).send({error:'monthly_quota_exceeded',tier});}
  await client.query('INSERT INTO az_requests(user_id,request_id,payload_hash,status) VALUES($1,$2,$3,$4)',[req.userId,input.requestId,hash,'running']);
  await client.query('COMMIT');
 }catch(err){await client.query('ROLLBACK').catch(()=>{});throw err;}finally{client.release();}
 try {
  const replies=await infer(input.message,context,tier,input.tone,input.customTone,input.variants,style);
  const result={requestId:input.requestId,tier,replies,insertRequiresUserAction:true};
  await pool.query("UPDATE az_requests SET status='completed',response=$3 WHERE user_id=$1 AND request_id=$2 AND status='running'",[req.userId,input.requestId,result]);
  return result;
 }catch(err){
  app.log.error({error:err.message},'inference failed');
  await pool.query("UPDATE az_requests SET status='failed' WHERE user_id=$1 AND request_id=$2 AND status='running'",[req.userId,input.requestId]).catch(()=>{});
  return reply.code(503).send({error:'reply_generation_unavailable'});
 }
});
app.setErrorHandler((err,req,reply)=>{req.log.error({error:err.message},'request failed');reply.code(500).send({error:'internal_error'});});
if(process.env.NODE_ENV!=='test') app.listen({port:Number(process.env.PORT||8080),host:'0.0.0.0'});
export {app,pool};
