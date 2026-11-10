import Fastify from 'fastify';
import pg from 'pg';
import {createRemoteJWKSet,jwtVerify} from 'jose';
import {config} from './config.mjs';
import {generateOllama,OllamaError} from './ollama.mjs';
import {reserveQuota,refundQuota} from './quota.mjs';

const cfg=config();
const app=Fastify({logger:{redact:['req.headers.authorization','req.body','res.body']},bodyLimit:128*1024,requestTimeout:60000,trustProxy:false});
const pool=new pg.Pool({connectionString:cfg.databaseUrl,max:10,connectionTimeoutMillis:3000,ssl:process.env.PG_SSL==='true'?{rejectUnauthorized:true}:undefined});
const jwks=createRemoteJWKSet(new URL(cfg.jwksUrl),{timeoutDuration:3000,cooldownDuration:30000});
let active=0;

app.addHook('onRequest',async(req,reply)=>{
  if(req.url==='/health/live')return;
  const header=req.headers.authorization;
  if(!header?.startsWith('Bearer '))return reply.code(401).send({error:'unauthorized'});
  try{
    const {payload}=await jwtVerify(header.slice(7),jwks,{issuer:cfg.issuer,audience:cfg.audience,algorithms:['RS256','ES256','EdDSA'],clockTolerance:5});
    if(typeof payload.sub!=='string'||typeof payload.tenant_id!=='string'||!payload.tenant_id||!Array.isArray(payload.scopes)||!payload.scopes.includes('ai:private:infer'))return reply.code(403).send({error:'forbidden'});
    req.identity={subject:payload.sub,tenantId:payload.tenant_id};
  }catch{return reply.code(401).send({error:'unauthorized'})}
});
app.get('/health/live',async()=>({status:'ok'}));
app.get('/health/ready',async(req,reply)=>{
  if(!cfg.enabled)return reply.code(503).send({status:'disabled'});
  try{await pool.query('SELECT 1');return {status:'ready',provider:'ollama'}}catch{return reply.code(503).send({status:'unavailable'})}
});
app.get('/v1/private/models',async()=>({provider:'ollama',models:[...cfg.models]}));
app.post('/v1/private/chat',async(req,reply)=>{
  if(!cfg.enabled)return reply.code(503).send({error:'private_ai_disabled'});
  const body=req.body;
  if(!body||typeof body!=='object'||Array.isArray(body)||!cfg.models.has(body.model)||!Array.isArray(body.messages)||body.messages.length<1||body.messages.length>32)return reply.code(400).send({error:'invalid_request'});
  let chars=0;
  for(const m of body.messages){if(!m||!['system','user','assistant'].includes(m.role)||typeof m.content!=='string'||!m.content.trim())return reply.code(400).send({error:'invalid_messages'});chars+=m.content.length}
  if(chars>cfg.maxInputChars)return reply.code(413).send({error:'input_too_large'});
  // Production integration must check live Qorlla tenant membership, plan, and suspension here.
  // This gateway only accepts dedicated service JWTs from the trusted Qorlla auth issuer.
  if(active>=cfg.maxConcurrent)return reply.code(429).send({error:'capacity_exceeded'});
  active++;
  let day=null;
  try{
    day=await reserveQuota(pool,req.identity.tenantId,cfg.maxDailyRequests);
    if(!day)return reply.code(429).send({error:'daily_limit_reached'});
    const result=await generateOllama({baseUrl:cfg.ollamaUrl,model:body.model,messages:body.messages,maxTokens:cfg.maxTokens,timeoutMs:cfg.timeoutMs});
    return reply.send({provider:'ollama',model:body.model,message:{role:'assistant',content:result.text},usage:{input_tokens:result.inputTokens,output_tokens:result.outputTokens}});
  }catch(err){
    if(day)await refundQuota(pool,req.identity.tenantId,day).catch(()=>app.log.error('quota refund failed'));
    return reply.code(err instanceof OllamaError?err.status:503).send({error:'inference_unavailable'});
  }finally{active--}
});
app.addHook('onClose',async()=>{await pool.end()});
const stop=async()=>{await app.close();process.exit(0)};
process.on('SIGTERM',stop);process.on('SIGINT',stop);
await app.listen({port:cfg.port,host:'0.0.0.0'});
