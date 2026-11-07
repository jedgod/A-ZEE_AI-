import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { Pool } from 'pg';
import { z } from 'zod';
import { createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';

const env = z.object({
  PORT:z.coerce.number().int().min(1).max(65535).default(3101), HOST:z.string().default('127.0.0.1'),
  DATABASE_URL:z.string().min(1), TAVILY_API_KEY:z.string().optional(),
  AUTH_JWKS_URL:z.string().url(), AUTH_ISSUER:z.string().min(1), AUTH_AUDIENCE:z.string().min(1),
  CORS_ORIGIN:z.string().url(), SANDBOX_IMAGE:z.string().default('azee-sandbox:local'),
  SANDBOX_ENABLED:z.enum(['true','false']).default('false')
}).parse(process.env);
const db = new Pool({connectionString:env.DATABASE_URL, max:10, connectionTimeoutMillis:3000});
const app = Fastify({logger:true, bodyLimit:128*1024, requestTimeout:20000});
await app.register(helmet);
await app.register(cors,{origin:env.CORS_ORIGIN,credentials:false});
await app.register(rateLimit,{max:60,timeWindow:'1 minute'});

// Verify asymmetric JWT signatures against issuer JWKS; never trust user-id headers.
let jwksCache:{keys:any[],at:number}|undefined;
async function jwks(){
 if(jwksCache && Date.now()-jwksCache.at<300000)return jwksCache.keys;
 const r=await fetch(env.AUTH_JWKS_URL,{signal:AbortSignal.timeout(4000)});
 if(!r.ok)throw new Error('Identity provider unavailable');
 const v=z.object({keys:z.array(z.record(z.unknown()))}).parse(await r.json());
 jwksCache={keys:v.keys,at:Date.now()};return v.keys;
}
function b64json(s:string){return JSON.parse(Buffer.from(s,'base64url').toString('utf8'));}
async function principal(auth:unknown){
 if(typeof auth!=='string'||!auth.startsWith('Bearer '))throw new Error('Unauthorized');
 const token=auth.slice(7);const parts=token.split('.');if(parts.length!==3)throw new Error('Unauthorized');
 const header=b64json(parts[0]);const claims=b64json(parts[1]);
 if(header.alg!=='RS256'||typeof header.kid!=='string')throw new Error('Unauthorized');
 const key=(await jwks()).find(k=>k.kid===header.kid&&k.kty==='RSA'&&k.use!=='enc');
 if(!key)throw new Error('Unauthorized');
 const ok=cryptoVerify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),createPublicKey({key:key as any,format:'jwk'}),Buffer.from(parts[2],'base64url'));
 const now=Math.floor(Date.now()/1000);
 if(!ok||claims.iss!==env.AUTH_ISSUER||!(claims.aud===env.AUTH_AUDIENCE||(Array.isArray(claims.aud)&&claims.aud.includes(env.AUTH_AUDIENCE)))||
 typeof claims.exp!=='number'||claims.exp<=now||typeof claims.iat!=='number'||claims.iat>now+60||
 typeof claims.sub!=='string'||!claims.sub||typeof claims.tenant_id!=='string'||!claims.tenant_id)throw new Error('Unauthorized');
 return {userId:claims.sub,tenantId:claims.tenant_id};
}
app.addHook('preHandler',async(req,reply)=>{
 if(req.url==='/health/live')return;
 try{(req as any).actor=await principal(req.headers.authorization);}catch{reply.code(401).send({error:'Unauthorized'});}
});
function actor(req:any){return req.actor as {userId:string,tenantId:string};}
async function audit(req:any,action:string,id?:string,details:object={}){
 const p=actor(req);await db.query('INSERT INTO audit_events(tenant_id,user_id,action,resource_id,details) VALUES($1,$2,$3,$4,$5)',[p.tenantId,p.userId,action,id??null,JSON.stringify(details)]);
}
app.get('/health/live',async()=>({status:'live'}));
app.get('/api/v1/platform/status',async(req)=>{
 let database=false;try{await db.query('SELECT 1');database=true;}catch{}
 return {search:{configured:!!env.TAVILY_API_KEY},database:{available:database},sandbox:{enabled:env.SANDBOX_ENABLED==='true'},cloudIDE:{status:'not_implemented'},voice:{status:'not_implemented'},connectors:{status:'not_implemented'}};
});
const searchSchema=z.object({query:z.string().trim().min(2).max(1000),timeRange:z.enum(['day','week','month','year']).optional()});
app.post('/api/v1/search/query',async(req,reply)=>{
 const parsed=searchSchema.safeParse(req.body);if(!parsed.success)return reply.code(400).send({error:'Invalid search query'});
 if(!env.TAVILY_API_KEY)return reply.code(503).send({error:'Search provider not configured'});
 const {query,timeRange}=parsed.data;
 let response:Response;
 try{response=await fetch('https://api.tavily.com/search',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${env.TAVILY_API_KEY}`},body:JSON.stringify({query,search_depth:'basic',max_results:6,include_answer:false,...(timeRange?{time_range:timeRange}:{})}),signal:AbortSignal.timeout(12000)});}catch{return reply.code(502).send({error:'Search provider unreachable'});}
 if(!response.ok)return reply.code(502).send({error:'Search provider failed'});
 const payload=z.object({results:z.array(z.object({title:z.string(),url:z.string().url(),content:z.string()})).default([])}).safeParse(await response.json());
 if(!payload.success)return reply.code(502).send({error:'Invalid provider response'});
 const sources=payload.data.results.map((s,i)=>({id:i+1,title:s.title,url:s.url,excerpt:s.content.slice(0,1600)}));
 // This endpoint returns evidence only; it deliberately does not fabricate a synthesized answer.
 const answer=sources.length?`Found ${sources.length} sources. Review the cited excerpts; AI synthesis is not configured.`:'No matching sources found.';
 const p=actor(req);
 const saved=await db.query('INSERT INTO search_queries(tenant_id,user_id,query,answer,sources) VALUES($1,$2,$3,$4,$5) RETURNING id,created_at',[p.tenantId,p.userId,query,answer,JSON.stringify(sources)]);
 await audit(req,'search.query',saved.rows[0].id,{sourceCount:sources.length});
 return {id:saved.rows[0].id,query,answer,sources,verified:false,createdAt:saved.rows[0].created_at};
});
app.get('/api/v1/search/history',async(req)=>{
 const p=actor(req);const r=await db.query('SELECT id,query,answer,sources,created_at FROM search_queries WHERE tenant_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 50',[p.tenantId,p.userId]);return {items:r.rows};
});
// Read-only repository inspection, restricted to configured per-tenant roots.
// Explicitly do not execute shell commands or modify source files in this starter.
const repoRoots=new Map<string,string>();
if(process.env.AZEE_REPO_ROOT && process.env.AZEE_REPO_TENANT)repoRoots.set(process.env.AZEE_REPO_TENANT,resolve(process.env.AZEE_REPO_ROOT));
app.post('/api/v1/code/read-file',async(req,reply)=>{
 const parsed=z.object({path:z.string().min(1).max(512)}).safeParse(req.body);
 if(!parsed.success)return reply.code(400).send({error:'Invalid path'});
 const p=actor(req),root=repoRoots.get(p.tenantId);
 if(!root)return reply.code(403).send({error:'Repository access not configured'});
 const base=await realpath(root),candidate=resolve(base,parsed.data.path);
 const rel=relative(base,candidate);
 if(rel==='..'||rel.startsWith('..'+sep)||rel.startsWith(sep))return reply.code(403).send({error:'Outside repository'});
 let actual:string;try{actual=await realpath(candidate);}catch{return reply.code(404).send({error:'File not found'});}
 const actualRel=relative(base,actual);
 if(actualRel==='..'||actualRel.startsWith('..'+sep)||actualRel.startsWith(sep))return reply.code(403).send({error:'Outside repository'});
 try{const content=await readFile(actual,'utf8');if(Buffer.byteLength(content)>256000)return reply.code(413).send({error:'File too large'});await audit(req,'code.read-file',undefined,{path:parsed.data.path});return {path:parsed.data.path,content};}
 catch{return reply.code(400).send({error:'Not a readable UTF-8 file'});}
});
app.addHook('onClose',async()=>{await db.end();});
app.setErrorHandler((error,req,reply)=>{req.log.error(error);reply.code(500).send({error:'Internal server error'});});
await app.listen({port:env.PORT,host:env.HOST});
