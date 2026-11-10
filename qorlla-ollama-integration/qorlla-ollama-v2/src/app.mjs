import Fastify from 'fastify';
import {createHash,randomUUID} from 'node:crypto';
import {createRemoteJWKSet,jwtVerify} from 'jose';
import {generateOllama} from './ollama.mjs';
import {createStore} from './store.mjs';

export function buildApp({store,verifyIdentity,generate=generateOllama,ollamaUrl,enabled=false,timeoutMs=45000,maxConcurrent=8}){
 const app=Fastify({bodyLimit:128*1024,requestTimeout:60000,logger:{redact:['req.headers.authorization','req.body','res.body']}});
 let active=0;
 app.addHook('onRequest',async(req,reply)=>{
   if(req.url==='/health/live')return;
   try{const id=await verifyIdentity(req.headers.authorization);if(!id?.tenant||!id?.subject||!id?.scopes?.includes('ai:private:infer'))throw Error();req.identity=id}
   catch{return reply.code(401).send({error:'unauthorized'})}
 });
 app.get('/health/live',async()=>({status:'ok'}));
 app.get('/health/ready',async(req,reply)=>enabled?{status:'ready',note:'provider readiness not certified'}:reply.code(503).send({status:'disabled'}));
 app.get('/v1/private/models',async(req)=>({models:await store.listModels(req.identity.tenant)}));
 app.get('/v1/private/usage',async(req)=>({usage:await store.usage(req.identity.tenant)}));
 app.post('/v1/private/chat',async(req,reply)=>{
   if(!enabled)return reply.code(503).send({error:'disabled'});
   const b=req.body;
   if(!b||typeof b!=='object'||Array.isArray(b)||typeof b.model!=='string'||b.model.length>120||!Array.isArray(b.messages)||b.messages.length<1||b.messages.length>32)return reply.code(400).send({error:'invalid_request'});
   let chars=0;
   for(const m of b.messages){if(!m||!['user','assistant','system'].includes(m.role)||typeof m.content!=='string'||!m.content.trim())return reply.code(400).send({error:'invalid_messages'});chars+=m.content.length}
   if(chars>16000)return reply.code(413).send({error:'input_too_large'});
   const requestId=req.headers['idempotency-key'];
   if(typeof requestId!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId))return reply.code(400).send({error:'idempotency_key_uuid_required'});
   const estimatedTokens=Math.ceil(chars/2)+1024; // conservative admission budget; not a tokenizer
   const hash=createHash('sha256').update(JSON.stringify({model:b.model,messages:b.messages})).digest('hex');
   if(active>=maxConcurrent)return reply.code(429).send({error:'capacity_exceeded'});
   const reservation=await store.reserve({tenant:req.identity.tenant,subject:req.identity.subject,model:b.model,requestId,hash,estimatedTokens});
   if(reservation.kind==='forbidden')return reply.code(403).send({error:'model_not_entitled'});
   if(reservation.kind==='quota')return reply.code(429).send({error:'quota_exceeded'});
   if(reservation.kind==='duplicate')return reply.code(409).send({error:'request_already_processed',status:reservation.status});
   if(reservation.kind==='conflict')return reply.code(409).send({error:'idempotency_conflict'});
   active++;
   try{
     const result=await generate({baseUrl:ollamaUrl,model:reservation.rule.upstream_model,messages:b.messages,maxTokens:Math.min(1024,reservation.rule.max_output_tokens),timeoutMs});
     await store.finish({tenant:req.identity.tenant,model:b.model,requestId,day:reservation.day,estimatedTokens,inputTokens:result.inputTokens,outputTokens:result.outputTokens});
     return {request_id:requestId,provider:'ollama',model:b.model,message:{role:'assistant',content:result.text},usage:{input_tokens:result.inputTokens,output_tokens:result.outputTokens}};
   }catch(e){
     await store.finish({tenant:req.identity.tenant,model:b.model,requestId,day:reservation.day,estimatedTokens,error:'inference_failed'});
     return reply.code(503).send({error:'inference_unavailable',request_id:requestId});
   }finally{active--}
 });
 app.addHook('onClose',async()=>store.close());
 return app;
}
export async function start(){
 const env=process.env;
 const store=await createStore({databaseUrl:env.DATABASE_URL,sqlitePath:env.SQLITE_PATH});
 if(!env.JWKS_URL||!env.JWT_ISSUER||!env.JWT_AUDIENCE||!env.OLLAMA_BASE_URL)throw Error('Missing authentication or Ollama configuration');
 const jwks=createRemoteJWKSet(new URL(env.JWKS_URL));
 const verifyIdentity=async(header)=>{
   if(!header?.startsWith('Bearer '))throw Error('token missing');
   const {payload}=await jwtVerify(header.slice(7),jwks,{issuer:env.JWT_ISSUER,audience:env.JWT_AUDIENCE,algorithms:['RS256','ES256','EdDSA']});
   if(typeof payload.sub!=='string'||typeof payload.tenant_id!=='string'||!Array.isArray(payload.scopes))throw Error('bad claims');
   // Integration gate: replace with live Qorlla session + tenant membership/suspension checks.
   return {tenant:payload.tenant_id,subject:payload.sub,scopes:payload.scopes};
 };
 const app=buildApp({store,verifyIdentity,ollamaUrl:env.OLLAMA_BASE_URL,enabled:env.OLLAMA_ENABLED==='true'});
 await app.listen({host:'0.0.0.0',port:Number(env.PORT||8090)});
 const stop=()=>app.close();process.on('SIGTERM',stop);process.on('SIGINT',stop);
}
