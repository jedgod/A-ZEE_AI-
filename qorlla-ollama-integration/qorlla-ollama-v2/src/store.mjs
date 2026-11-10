import {DatabaseSync} from 'node:sqlite';

// These adapters are intentionally restricted to the provider/model/usage tables.
export async function createStore({databaseUrl,sqlitePath}={}) {
  if (!!databaseUrl === !!sqlitePath) throw new Error('Select exactly one database');
  if (sqlitePath) return sqliteStore(sqlitePath);
  return postgresStore(databaseUrl);
}
function sqliteStore(path) {
  const db=new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
  const get=(sql,...args)=>db.prepare(sql).get(...args);
  return {
    async listModels(tenant) {return db.prepare(`SELECT m.model_id,m.upstream_model,m.max_output_tokens,p.kind,p.private_only FROM ai_model_registry m JOIN ai_provider_registry p ON p.provider_id=m.provider_id JOIN ai_tenant_model_entitlements e ON e.model_id=m.model_id WHERE e.tenant_id=? AND m.enabled=1 AND p.enabled=1`).all(tenant)},
    async reserve({tenant,subject,model,requestId,hash,estimatedTokens}) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const prior=get('SELECT request_hash,status FROM ai_inference_requests WHERE request_id=? AND tenant_id=?',requestId,tenant);
        if(prior){db.exec('COMMIT');return {kind:prior.request_hash===hash?'duplicate':'conflict',status:prior.status}}
        const rule=get(`SELECT e.daily_request_limit,e.daily_token_limit,m.enabled AS model_enabled,p.enabled AS provider_enabled,p.kind,p.private_only,m.upstream_model,m.max_output_tokens FROM ai_tenant_model_entitlements e JOIN ai_model_registry m ON m.model_id=e.model_id JOIN ai_provider_registry p ON p.provider_id=m.provider_id WHERE e.tenant_id=? AND e.model_id=?`,tenant,model);
        if(!rule||!rule.model_enabled||!rule.provider_enabled){db.exec('COMMIT');return {kind:'forbidden'}}
        if(rule.kind!=='ollama'||!rule.private_only){db.exec('COMMIT');return {kind:'forbidden'}}
        const day=new Date().toISOString().slice(0,10);
        db.prepare(`INSERT INTO ai_daily_usage(tenant_id,model_id,usage_day,requests,tokens) VALUES(?,?,?,0,0) ON CONFLICT DO NOTHING`).run(tenant,model,day);
        const usage=get('SELECT requests,tokens FROM ai_daily_usage WHERE tenant_id=? AND model_id=? AND usage_day=?',tenant,model,day);
        if(usage.requests>=rule.daily_request_limit||usage.tokens+estimatedTokens>rule.daily_token_limit){db.exec('COMMIT');return {kind:'quota'}}
        db.prepare('UPDATE ai_daily_usage SET requests=requests+1,tokens=tokens+? WHERE tenant_id=? AND model_id=? AND usage_day=?').run(estimatedTokens,tenant,model,day);
        db.prepare(`INSERT INTO ai_inference_requests(request_id,tenant_id,subject_id,model_id,request_hash,status) VALUES(?,?,?,?,?,'reserved')`).run(requestId,tenant,subject,model,hash);
        db.exec('COMMIT');return {kind:'reserved',rule,day};
      } catch(e){db.exec('ROLLBACK');throw e}
    },
    async finish({tenant,model,requestId,day,estimatedTokens,inputTokens,outputTokens,error}) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const row=get('SELECT status FROM ai_inference_requests WHERE tenant_id=? AND request_id=?',tenant,requestId);
        if(!row||row.status!=='reserved'){db.exec('COMMIT');return false}
        const used=error?0:Math.max(0,(inputTokens??0)+(outputTokens??0));
        db.prepare('UPDATE ai_daily_usage SET tokens=MAX(0,tokens+?),requests=MAX(0,requests+?) WHERE tenant_id=? AND model_id=? AND usage_day=?').run(used-estimatedTokens,error?-1:0,tenant,model,day);
        db.prepare(`UPDATE ai_inference_requests SET status=?,input_tokens=?,output_tokens=?,error_code=?,completed_at=CURRENT_TIMESTAMP WHERE tenant_id=? AND request_id=?`).run(error?'failed':'completed',inputTokens??null,outputTokens??null,error??null,tenant,requestId);
        db.exec('COMMIT');return true;
      }catch(e){db.exec('ROLLBACK');throw e}
    },
    async usage(tenant){return db.prepare('SELECT model_id,usage_day,requests,tokens FROM ai_daily_usage WHERE tenant_id=? ORDER BY usage_day DESC LIMIT 100').all(tenant)},
    async close(){db.close()}
  };
}
async function postgresStore(url){
  const {default:pg}=await import('pg');
  const pool=new pg.Pool({connectionString:url,max:10,connectionTimeoutMillis:3000,ssl:process.env.PG_SSL==='true'?{rejectUnauthorized:true}:undefined});
  return {
    async listModels(tenant){const {rows}=await pool.query(`SELECT m.model_id,m.upstream_model,m.max_output_tokens,p.kind,p.private_only FROM ai_model_registry m JOIN ai_provider_registry p ON p.provider_id=m.provider_id JOIN ai_tenant_model_entitlements e ON e.model_id=m.model_id WHERE e.tenant_id=$1 AND m.enabled=true AND p.enabled=true`,[tenant]);return rows},
    async reserve({tenant,subject,model,requestId,hash,estimatedTokens}){
      const c=await pool.connect();try{
        await c.query('BEGIN');
        // Serialize reservations for the tenant+model, including when the daily row does not yet exist.
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[tenant+'|'+model]);
        const prior=await c.query('SELECT request_hash,status FROM ai_inference_requests WHERE request_id=$1 AND tenant_id=$2',[requestId,tenant]);
        if(prior.rowCount){await c.query('COMMIT');return {kind:prior.rows[0].request_hash===hash?'duplicate':'conflict',status:prior.rows[0].status}}
        const r=await c.query(`SELECT e.daily_request_limit,e.daily_token_limit,m.enabled AS model_enabled,p.enabled AS provider_enabled,p.kind,p.private_only,m.upstream_model,m.max_output_tokens FROM ai_tenant_model_entitlements e JOIN ai_model_registry m ON m.model_id=e.model_id JOIN ai_provider_registry p ON p.provider_id=m.provider_id WHERE e.tenant_id=$1 AND e.model_id=$2`,[tenant,model]);
        const rule=r.rows[0];
        if(!rule||!rule.model_enabled||!rule.provider_enabled||rule.kind!=='ollama'||!rule.private_only){await c.query('COMMIT');return {kind:'forbidden'}}
        const day=new Date().toISOString().slice(0,10);
        await c.query(`INSERT INTO ai_daily_usage(tenant_id,model_id,usage_day,requests,tokens) VALUES($1,$2,$3,0,0) ON CONFLICT DO NOTHING`,[tenant,model,day]);
        const usage=(await c.query('SELECT requests,tokens FROM ai_daily_usage WHERE tenant_id=$1 AND model_id=$2 AND usage_day=$3 FOR UPDATE',[tenant,model,day])).rows[0];
        if(usage.requests>=rule.daily_request_limit||BigInt(usage.tokens)+BigInt(estimatedTokens)>BigInt(rule.daily_token_limit)){await c.query('COMMIT');return {kind:'quota'}}
        await c.query('UPDATE ai_daily_usage SET requests=requests+1,tokens=tokens+$4 WHERE tenant_id=$1 AND model_id=$2 AND usage_day=$3',[tenant,model,day,estimatedTokens]);
        await c.query(`INSERT INTO ai_inference_requests(request_id,tenant_id,subject_id,model_id,request_hash,status) VALUES($1,$2,$3,$4,$5,'reserved')`,[requestId,tenant,subject,model,hash]);
        await c.query('COMMIT');return {kind:'reserved',rule,day};
      }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
    },
    async finish({tenant,model,requestId,day,estimatedTokens,inputTokens,outputTokens,error}){
      const c=await pool.connect();try{await c.query('BEGIN');
        const r=await c.query(`UPDATE ai_inference_requests SET status=$3,input_tokens=$4,output_tokens=$5,error_code=$6,completed_at=now() WHERE tenant_id=$1 AND request_id=$2 AND status='reserved' RETURNING request_id`,[tenant,requestId,error?'failed':'completed',inputTokens??null,outputTokens??null,error??null]);
        if(!r.rowCount){await c.query('COMMIT');return false}
        const used=error?0:Math.max(0,(inputTokens??0)+(outputTokens??0));
        await c.query('UPDATE ai_daily_usage SET tokens=GREATEST(0,tokens+$4),requests=GREATEST(0,requests+$5) WHERE tenant_id=$1 AND model_id=$2 AND usage_day=$3',[tenant,model,day,used-estimatedTokens,error?-1:0]);
        await c.query('COMMIT');return true;
      }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
    },
    async usage(tenant){return (await pool.query('SELECT model_id,usage_day,requests,tokens FROM ai_daily_usage WHERE tenant_id=$1 ORDER BY usage_day DESC LIMIT 100',[tenant])).rows},
    async close(){await pool.end()}
  }
}
