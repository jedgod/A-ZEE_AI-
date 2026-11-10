import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';

const now=()=>new Date().toISOString();
const day=()=>now().slice(0,10);
const plus=(ms)=>new Date(Date.now()+ms).toISOString();
const n=(v)=>Number(v);

export async function createStore({sqlitePath,databaseUrl,leaseMs=90000}={}) {
 if(Boolean(sqlitePath)===Boolean(databaseUrl)) throw Error('Provide exactly one of SQLITE_PATH or DATABASE_URL');
 if(sqlitePath) return sqliteStore(sqlitePath,leaseMs);
 return pgStore(databaseUrl,leaseMs);
}
function sqliteStore(path,leaseMs){
 const db=new DatabaseSync(path);db.exec('PRAGMA foreign_keys=ON;PRAGMA journal_mode=WAL;PRAGMA busy_timeout=5000');
 const one=(q,...v)=>db.prepare(q).get(...v),all=(q,...v)=>db.prepare(q).all(...v),run=(q,...v)=>db.prepare(q).run(...v);
 const tx=(fn)=>{db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}};
 function recover(){
  const expired=all("SELECT request_id,tenant_id,model_id,usage_day,reserved_tokens FROM ai_inference_requests WHERE status='running' AND lease_expires_at < ?",now());
  for(const r of expired){
   run("UPDATE ai_inference_requests SET status='recovery_required',lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE request_id=? AND status='running'",now(),r.request_id);
   run('UPDATE ai_tenant_active SET active_count=MAX(0,active_count-1) WHERE tenant_id=?',r.tenant_id);
   // Do not refund tokens: a remote inference may have executed; requires explicit reconciliation.
  }
  return expired.length;
 }
 return {
  async reserve({tenant,subject,model,requestId,hash,reservedTokens}){return tx(()=>{
   recover();
   const old=one('SELECT request_hash,status,response_json FROM ai_inference_requests WHERE request_id=?',requestId);
   if(old)return old.request_hash!==hash?{kind:'conflict'}:{kind:'existing',status:old.status,response:old.response_json?JSON.parse(old.response_json):null};
   const rule=one(`SELECT e.daily_request_limit,e.daily_token_limit,m.upstream_model,m.max_output_tokens FROM ai_tenant_model_entitlements e JOIN ai_model_registry m ON e.model_id=m.model_id JOIN ai_provider_registry p ON p.provider_id=m.provider_id WHERE e.tenant_id=? AND e.model_id=? AND m.enabled=1 AND p.enabled=1 AND p.kind='ollama' AND p.private_only=1`,tenant,model);
   if(!rule)return {kind:'forbidden'};
   const max=one('SELECT max_concurrent FROM ai_tenant_limits WHERE tenant_id=?',tenant)?.max_concurrent;
   if(!max)return {kind:'forbidden'};
   run('INSERT INTO ai_tenant_active(tenant_id,active_count) VALUES(?,0) ON CONFLICT DO NOTHING',tenant);
   if(one('SELECT active_count FROM ai_tenant_active WHERE tenant_id=?',tenant).active_count>=max)return {kind:'capacity'};
   const d=day();run('INSERT INTO ai_daily_usage(tenant_id,model_id,usage_day,requests,tokens) VALUES(?,?,?,0,0) ON CONFLICT DO NOTHING',tenant,model,d);
   const u=one('SELECT requests,tokens FROM ai_daily_usage WHERE tenant_id=? AND model_id=? AND usage_day=?',tenant,model,d);
   if(u.requests>=rule.daily_request_limit||u.tokens+reservedTokens>rule.daily_token_limit)return {kind:'quota'};
   run('UPDATE ai_daily_usage SET requests=requests+1,tokens=tokens+? WHERE tenant_id=? AND model_id=? AND usage_day=?',reservedTokens,tenant,model,d);
   run('UPDATE ai_tenant_active SET active_count=active_count+1 WHERE tenant_id=?',tenant);
   const owner=randomUUID();
   run(`INSERT INTO ai_inference_requests(request_id,tenant_id,subject_id,model_id,request_hash,status,reserved_tokens,usage_day,lease_owner,lease_epoch,lease_expires_at,updated_at) VALUES(?,?,?,?,?,'running',?,?,?,?,?,?)`,requestId,tenant,subject,model,hash,reservedTokens,d,owner,1,plus(leaseMs),now());
   return {kind:'started',owner,epoch:1,rule};
  })},
  async heartbeat({requestId,owner,epoch}){return tx(()=>run("UPDATE ai_inference_requests SET lease_expires_at=?,updated_at=? WHERE request_id=? AND status='running' AND lease_owner=? AND lease_epoch=? AND lease_expires_at>?",plus(leaseMs),now(),requestId,owner,epoch,now()).changes===1)},
  async complete({requestId,owner,epoch,result,error}){return tx(()=>{
   const r=one("SELECT * FROM ai_inference_requests WHERE request_id=? AND status='running' AND lease_owner=? AND lease_epoch=? AND lease_expires_at>?",requestId,owner,epoch,now());if(!r)return false;
   const used=error?0:Math.max(0,n(result?.usage?.input_tokens||0)+n(result?.usage?.output_tokens||0));
   // Reserve a conservative upper bound. If provider reports more, retain true accounting; reject further quota admissions.
   run('UPDATE ai_daily_usage SET tokens=MAX(0,tokens+?) WHERE tenant_id=? AND model_id=? AND usage_day=?',used-r.reserved_tokens,r.tenant_id,r.model_id,r.usage_day);
   run('UPDATE ai_tenant_active SET active_count=MAX(0,active_count-1) WHERE tenant_id=?',r.tenant_id);
   run(`UPDATE ai_inference_requests SET status=?,response_json=?,input_tokens=?,output_tokens=?,error_code=?,lease_owner=NULL,lease_expires_at=NULL,updated_at=?,completed_at=? WHERE request_id=?`,error?'failed':'completed',error?null:JSON.stringify(result),result?.usage?.input_tokens??null,result?.usage?.output_tokens??null,error||null,now(),now(),requestId);
   return true;
  })},
  async cancel({tenant,subject,requestId}){return tx(()=>{
   const r=one('SELECT * FROM ai_inference_requests WHERE tenant_id=? AND subject_id=? AND request_id=?',tenant,subject,requestId);
   if(!r)return 'missing';if(r.status!=='running')return r.status;
   run("UPDATE ai_inference_requests SET status='cancelled',lease_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE request_id=?",now(),requestId);
   run('UPDATE ai_tenant_active SET active_count=MAX(0,active_count-1) WHERE tenant_id=?',tenant);
   // No automatic token refund: remote execution may already have started.
   return 'cancelled';
  })},
  async get(tenant,subject,id){const r=one('SELECT request_id,model_id,status,input_tokens,output_tokens,error_code,created_at,completed_at FROM ai_inference_requests WHERE tenant_id=? AND subject_id=? AND request_id=?',tenant,subject,id);return r||null},
  async usage(tenant){return all('SELECT model_id,usage_day,requests,tokens FROM ai_daily_usage WHERE tenant_id=? ORDER BY usage_day DESC LIMIT 100',tenant)},
  async models(tenant){return all(`SELECT m.model_id,m.max_output_tokens FROM ai_model_registry m JOIN ai_provider_registry p ON p.provider_id=m.provider_id JOIN ai_tenant_model_entitlements e ON e.model_id=m.model_id WHERE e.tenant_id=? AND m.enabled=1 AND p.enabled=1 AND p.kind='ollama' AND p.private_only=1`,tenant)},
  async recover(){return tx(recover)},async ready(){return !!one('SELECT 1 AS ok')},async close(){db.close()}
 };
}
async function pgStore(url,leaseMs){
 const {default:pg}=await import('pg');const pool=new pg.Pool({connectionString:url,max:12,connectionTimeoutMillis:4000});
 const transaction=async(fn)=>{const c=await pool.connect();try{await c.query('BEGIN');const v=await fn(c);await c.query('COMMIT');return v}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}};
 const first=async(c,q,v=[])=> (await c.query(q,v)).rows[0];
 async function recover(c){
  const r=await c.query(`UPDATE ai_inference_requests SET status='recovery_required',lease_owner=NULL,lease_expires_at=NULL,updated_at=now() WHERE status='running' AND lease_expires_at<now() RETURNING tenant_id`);
  for(const x of r.rows)await c.query('UPDATE ai_tenant_active SET active_count=GREATEST(0,active_count-1) WHERE tenant_id=$1',[x.tenant_id]);
  return r.rowCount;
 }
 return {
  async reserve({tenant,subject,model,requestId,hash,reservedTokens}){return transaction(async c=>{
   await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[tenant]);await recover(c);
   const old=await first(c,'SELECT request_hash,status,response_json FROM ai_inference_requests WHERE request_id=$1',[requestId]);
   if(old)return old.request_hash!==hash?{kind:'conflict'}:{kind:'existing',status:old.status,response:old.response_json};
   const rule=await first(c,`SELECT e.daily_request_limit,e.daily_token_limit,m.upstream_model,m.max_output_tokens FROM ai_tenant_model_entitlements e JOIN ai_model_registry m ON e.model_id=m.model_id JOIN ai_provider_registry p ON p.provider_id=m.provider_id WHERE e.tenant_id=$1 AND e.model_id=$2 AND m.enabled=true AND p.enabled=true AND p.kind='ollama' AND p.private_only=true`,[tenant,model]);
   if(!rule)return {kind:'forbidden'};
   const lim=await first(c,'SELECT max_concurrent FROM ai_tenant_limits WHERE tenant_id=$1',[tenant]);if(!lim)return {kind:'forbidden'};
   await c.query('INSERT INTO ai_tenant_active(tenant_id,active_count) VALUES($1,0) ON CONFLICT DO NOTHING',[tenant]);
   const a=await first(c,'SELECT active_count FROM ai_tenant_active WHERE tenant_id=$1 FOR UPDATE',[tenant]);if(n(a.active_count)>=n(lim.max_concurrent))return {kind:'capacity'};
   const d=day();await c.query('INSERT INTO ai_daily_usage(tenant_id,model_id,usage_day,requests,tokens) VALUES($1,$2,$3,0,0) ON CONFLICT DO NOTHING',[tenant,model,d]);
   const u=await first(c,'SELECT requests,tokens FROM ai_daily_usage WHERE tenant_id=$1 AND model_id=$2 AND usage_day=$3 FOR UPDATE',[tenant,model,d]);
   if(n(u.requests)>=n(rule.daily_request_limit)||BigInt(u.tokens)+BigInt(reservedTokens)>BigInt(rule.daily_token_limit))return {kind:'quota'};
   await c.query('UPDATE ai_daily_usage SET requests=requests+1,tokens=tokens+$4 WHERE tenant_id=$1 AND model_id=$2 AND usage_day=$3',[tenant,model,d,reservedTokens]);
   await c.query('UPDATE ai_tenant_active SET active_count=active_count+1 WHERE tenant_id=$1',[tenant]);
   const owner=randomUUID();
   await c.query(`INSERT INTO ai_inference_requests(request_id,tenant_id,subject_id,model_id,request_hash,status,reserved_tokens,usage_day,lease_owner,lease_epoch,lease_expires_at,updated_at) VALUES($1,$2,$3,$4,$5,'running',$6,$7,$8,1,now()+($9::int*interval '1 millisecond'),now())`,[requestId,tenant,subject,model,hash,reservedTokens,d,owner,leaseMs]);
   return {kind:'started',owner,epoch:1,rule};
  })},
  async heartbeat({requestId,owner,epoch}){const r=await pool.query(`UPDATE ai_inference_requests SET lease_expires_at=now()+($4::int*interval '1 millisecond'),updated_at=now() WHERE request_id=$1 AND lease_owner=$2 AND lease_epoch=$3 AND status='running' AND lease_expires_at>now()`,[requestId,owner,epoch,leaseMs]);return r.rowCount===1},
  async complete({requestId,owner,epoch,result,error}){return transaction(async c=>{
   const r=await first(c,"SELECT * FROM ai_inference_requests WHERE request_id=$1 AND lease_owner=$2 AND lease_epoch=$3 AND status='running' AND lease_expires_at>now() FOR UPDATE",[requestId,owner,epoch]);if(!r)return false;
   const used=error?0:Math.max(0,n(result?.usage?.input_tokens||0)+n(result?.usage?.output_tokens||0));
   await c.query('UPDATE ai_daily_usage SET tokens=GREATEST(0,tokens+$4) WHERE tenant_id=$1 AND model_id=$2 AND usage_day=$3',[r.tenant_id,r.model_id,r.usage_day,used-n(r.reserved_tokens)]);
   await c.query('UPDATE ai_tenant_active SET active_count=GREATEST(0,active_count-1) WHERE tenant_id=$1',[r.tenant_id]);
   await c.query(`UPDATE ai_inference_requests SET status=$2,response_json=$3,input_tokens=$4,output_tokens=$5,error_code=$6,lease_owner=NULL,lease_expires_at=NULL,updated_at=now(),completed_at=now() WHERE request_id=$1`,[requestId,error?'failed':'completed',error?null:JSON.stringify(result),result?.usage?.input_tokens??null,result?.usage?.output_tokens??null,error||null]);return true;
  })},
  async cancel({tenant,subject,requestId}){return transaction(async c=>{
   const r=await first(c,'SELECT status FROM ai_inference_requests WHERE tenant_id=$1 AND subject_id=$2 AND request_id=$3 FOR UPDATE',[tenant,subject,requestId]);if(!r)return 'missing';if(r.status!=='running')return r.status;
   await c.query("UPDATE ai_inference_requests SET status='cancelled',lease_owner=NULL,lease_expires_at=NULL,updated_at=now() WHERE request_id=$1",[requestId]);
   await c.query('UPDATE ai_tenant_active SET active_count=GREATEST(0,active_count-1) WHERE tenant_id=$1',[tenant]);return 'cancelled';
  })},
  async get(tenant,subject,id){return (await pool.query('SELECT request_id,model_id,status,input_tokens,output_tokens,error_code,created_at,completed_at FROM ai_inference_requests WHERE tenant_id=$1 AND subject_id=$2 AND request_id=$3',[tenant,subject,id])).rows[0]||null},
  async usage(tenant){return (await pool.query('SELECT model_id,usage_day,requests,tokens FROM ai_daily_usage WHERE tenant_id=$1 ORDER BY usage_day DESC LIMIT 100',[tenant])).rows},
  async models(tenant){return (await pool.query(`SELECT m.model_id,m.max_output_tokens FROM ai_model_registry m JOIN ai_provider_registry p ON p.provider_id=m.provider_id JOIN ai_tenant_model_entitlements e ON e.model_id=m.model_id WHERE e.tenant_id=$1 AND m.enabled=true AND p.enabled=true AND p.kind='ollama' AND p.private_only=true`,[tenant])).rows},
  async recover(){return transaction(recover)},async ready(){await pool.query('SELECT 1');return true},async close(){await pool.end()}
 };
}
