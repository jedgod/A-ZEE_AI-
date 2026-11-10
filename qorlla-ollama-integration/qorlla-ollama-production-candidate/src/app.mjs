import {createHash} from 'node:crypto';
import Fastify from 'fastify';
import {generateOllama} from './ollama.mjs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function buildApp({store,verifyIdentity,ollamaUrl,enabled=false,generate=generateOllama,timeoutMs=45000,heartbeatMs=10000,maxOutputTokens=1024}){
 const app=Fastify({bodyLimit:128*1024,requestTimeout:120000,logger:{redact:['req.headers.authorization','req.body','res.body']}});
 const inFlight=new Map();
 app.get('/health/live',async()=>({status:'ok'}));
 app.addHook('onRequest',async(req,reply)=>{
  if(req.url==='/health/live')return;
  if(req.url==='/health/ready'){
   if(req.headers['x-health-token']!==process.env.HEALTH_TOKEN||!process.env.HEALTH_TOKEN)return reply.code(401).send({error:'unauthorized'});
   return;
  }
  try{req.identity=await verifyIdentity(req.headers.authorization)}catch{return reply.code(401).send({error:'unauthorized'})}
 });
 app.get('/health/ready',async(req,reply)=>enabled&&await store.ready()?{status:'ready'}:reply.code(503).send({status:'unavailable'}));
 app.get('/v1/private/models',async(req)=>({models:await store.models(req.identity.tenant)}));
 app.get('/v1/private/usage',async(req)=>({usage:await store.usage(req.identity.tenant)}));
 app.get('/v1/private/requests/:id',async(req,reply)=>{
  if(!uuid.test(req.params.id))return reply.code(400).send({error:'invalid_id'});
  const r=await store.get(req.identity.tenant,req.identity.subject,req.params.id);return r||reply.code(404).send({error:'not_found'});
 });
 app.post('/v1/private/requests/:id/cancel',async(req,reply)=>{
  if(!uuid.test(req.params.id))return reply.code(400).send({error:'invalid_id'});
  const state=await store.cancel({tenant:req.identity.tenant,subject:req.identity.subject,requestId:req.params.id});
  if(state==='missing')return reply.code(404).send({error:'not_found'});
  inFlight.get(`${req.identity.tenant}:${req.params.id}`)?.abort();
  return {request_id:req.params.id,status:state};
 });
 app.post('/v1/private/chat',async(req,reply)=>{
  if(!enabled)return reply.code(503).send({error:'disabled'});
  const b=req.body;
  if(!b||Array.isArray(b)||typeof b!=='object'||typeof b.model!=='string'||!/^[\w./:-]{1,120}$/.test(b.model)||!Array.isArray(b.messages)||b.messages.length<1||b.messages.length>32||b.stream===true)return reply.code(400).send({error:'invalid_request'});
  let chars=0;
  for(const m of b.messages){if(!m||!['system','user','assistant'].includes(m.role)||typeof m.content!=='string'||!m.content.trim())return reply.code(400).send({error:'invalid_messages'});chars+=m.content.length}
  if(chars>16000)return reply.code(413).send({error:'input_too_large'});
  const id=req.headers['idempotency-key'];if(typeof id!=='string'||!uuid.test(id))return reply.code(400).send({error:'idempotency_key_uuid_required'});
  const hash=createHash('sha256').update(JSON.stringify({model:b.model,messages:b.messages})).digest('hex');
  // Admission bound is deliberately conservative and not a substitute for tokenizer-level metering.
  const reservedTokens=Math.ceil(chars/2)+maxOutputTokens;
  const r=await store.reserve({tenant:req.identity.tenant,subject:req.identity.subject,model:b.model,requestId:id,hash,reservedTokens});
  if(r.kind==='forbidden')return reply.code(403).send({error:'not_entitled'});
  if(r.kind==='quota'||r.kind==='capacity')return reply.code(429).send({error:r.kind==='quota'?'quota_exceeded':'capacity_exceeded'});
  if(r.kind==='conflict')return reply.code(409).send({error:'idempotency_conflict'});
  if(r.kind==='existing')return r.status==='completed'&&r.response?{...r.response,idempotent_replay:true}:reply.code(409).send({error:'request_not_replayable',status:r.status});
  const ctrl=new AbortController();const key=`${req.identity.tenant}:${id}`;inFlight.set(key,ctrl);
  let lost=false;let heartbeatBusy=false;
  const interval=setInterval(async()=>{
   if(heartbeatBusy)return;heartbeatBusy=true;
   try{if(!await store.heartbeat({requestId:id,owner:r.owner,epoch:r.epoch})){lost=true;ctrl.abort()}}catch{lost=true;ctrl.abort()}finally{heartbeatBusy=false}
  },heartbeatMs);interval.unref?.();
  try{
   const output=await generate({baseUrl:ollamaUrl,model:r.rule.upstream_model,messages:b.messages,maxTokens:Math.min(maxOutputTokens,Number(r.rule.max_output_tokens)),timeoutMs,signal:ctrl.signal});
   if(!Number.isSafeInteger(output.inputTokens)||output.inputTokens<0||!Number.isSafeInteger(output.outputTokens)||output.outputTokens<0||typeof output.text!=='string')throw Error('invalid_usage');
   const result={request_id:id,provider:'ollama',model:b.model,message:{role:'assistant',content:output.text},usage:{input_tokens:output.inputTokens,output_tokens:output.outputTokens}};
   if(lost||!await store.complete({requestId:id,owner:r.owner,epoch:r.epoch,result}))return reply.code(409).send({error:'lease_lost',request_id:id});
   return result;
  }catch{
   if(!lost)await store.complete({requestId:id,owner:r.owner,epoch:r.epoch,error:'inference_failed'});
   return reply.code(503).send({error:'inference_unavailable',request_id:id});
  }finally{clearInterval(interval);inFlight.delete(key)}
 });
 app.addHook('onClose',async()=>{for(const c of inFlight.values())c.abort();await store.close()});
 app.setErrorHandler((err,req,reply)=>{
  req.log.error({code:err.code,statusCode:err.statusCode},'request failed');
  reply.code(err.statusCode&&err.statusCode<500?err.statusCode:503).send({error:'request_failed'});
 });
 return app;
}
