import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createStore} from '../src/store.mjs';
const root=new URL('../sql/001_sqlite.sql',import.meta.url);
async function fixture(fn){
 const dir=mkdtempSync(join(tmpdir(),'qorlla-ai-'));const file=join(dir,'db.sqlite');
 const db=new DatabaseSync(file);db.exec(readFileSync(root,'utf8'));
 db.exec("INSERT INTO ai_provider_registry(provider_id,kind,enabled,private_only) VALUES('ollama','ollama',1,1)");
 db.exec("INSERT INTO ai_model_registry(model_id,provider_id,upstream_model,enabled,max_output_tokens) VALUES('private-small','ollama','qwen2.5:0.5b',1,512)");
 db.exec("INSERT INTO ai_tenant_model_entitlements(tenant_id,model_id,daily_request_limit,daily_token_limit) VALUES('tenant-a','private-small',2,10000)");
 db.exec("INSERT INTO ai_tenant_limits(tenant_id,max_concurrent) VALUES('tenant-a',1)");db.close();
 const store=await createStore({sqlitePath:file});try{await fn(store)}finally{await store.close();rmSync(dir,{recursive:true,force:true})}
}
const input=(id=randomUUID())=>({tenant:'tenant-a',subject:'alice',model:'private-small',requestId:id,hash:'abc',reservedTokens:100});
test('atomic admission, concurrency, completed replay and conflict',async()=>fixture(async s=>{
 const a=input();const r=await s.reserve(a);assert.equal(r.kind,'started');
 assert.equal((await s.reserve(input())).kind,'capacity');
 assert.equal((await s.reserve(a)).kind,'existing');
 assert.equal((await s.reserve({...a,hash:'different'})).kind,'conflict');
 const result={usage:{input_tokens:12,output_tokens:8},message:{content:'hello'}};
 assert.equal(await s.complete({requestId:a.requestId,owner:r.owner,epoch:r.epoch,result}),true);
 assert.equal(await s.complete({requestId:a.requestId,owner:r.owner,epoch:r.epoch,result}),false);
 const replay=await s.reserve(a);assert.equal(replay.kind,'existing');assert.deepEqual(replay.response,result);
 assert.equal((await s.reserve(input())).kind,'started');
 assert.equal((await s.reserve(input())).kind,'capacity');
}));
test('fencing, subject isolation, cancellation and usage accounting',async()=>fixture(async s=>{
 const a=input(),r=await s.reserve(a);
 assert.equal(await s.heartbeat({requestId:a.requestId,owner:'wrong',epoch:r.epoch}),false);
 assert.equal(await s.complete({requestId:a.requestId,owner:'wrong',epoch:r.epoch,result:{}}),false);
 assert.equal(await s.get('tenant-a','bob',a.requestId),null);
 assert.equal(await s.cancel({tenant:'tenant-a',subject:'bob',requestId:a.requestId}),'missing');
 assert.equal(await s.cancel({tenant:'tenant-a',subject:'alice',requestId:a.requestId}),'cancelled');
 assert.equal(await s.complete({requestId:a.requestId,owner:r.owner,epoch:r.epoch,result:{}}),false);
 assert.equal((await s.usage('tenant-a'))[0].tokens,100);
}));
test('tenant/model allowlist enforced',async()=>fixture(async s=>{
 assert.equal((await s.reserve({...input(),tenant:'other'})).kind,'forbidden');
 assert.equal((await s.reserve({...input(),model:'not-allowed'})).kind,'forbidden');
 assert.equal((await s.models('tenant-a')).length,1);
}));
