import {beforeAll,afterAll,describe,it,expect,vi} from "vitest";
import {readFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
import {Pool} from "pg";
import {createRequire} from "node:module";
const state=vi.hoisted(()=>({db:null as any}));
vi.mock("@/lib/admin/db",()=>({pool:{query:(...args:any[])=>state.db.query(...args),connect:()=>state.db.connect()}}));
vi.mock("@/lib/pipeline",()=>({answerChat:vi.fn()}));
import {chargeRequest,refundRequest} from "@/lib/linqext/entitlements";
import {chargeRequest as chargeTrade,refundRequest as refundTrade} from "@/lib/aztrade/ai";
const {maintain}=createRequire(import.meta.url)("../scripts/lib/inference-maintenance.cjs");
const enabled=process.env.AZTRADE_CERT_DISPOSABLE==='YES' && Boolean(process.env.AZTRADE_CERT_CONFIG);
const schema='inference_cert_'+randomUUID().replaceAll('-','');
let admin:Pool;
describe.skipIf(!enabled)('real PostgreSQL inference recovery and fencing',()=>{
 beforeAll(async()=>{
  const config=JSON.parse(readFileSync(process.env.AZTRADE_CERT_CONFIG!,'utf8'));
  if(!config.disposable || !['localhost','127.0.0.1'].includes(new URL(config.ownerUrl).hostname))throw new Error('Disposable local database required');
  admin=new Pool({connectionString:config.ownerUrl});
  await admin.query(`CREATE SCHEMA ${schema}`);
  state.db=new Pool({connectionString:config.ownerUrl,options:`-c search_path=${schema},public`});
  for(const prefix of ['linqext','aztrade_ai']){
   await state.db.query(`CREATE TABLE ${prefix}_requests(user_id text,request_id uuid,payload_hash text,status text,response jsonb,charged_period date,created_at timestamptz DEFAULT now(),attempt_id uuid DEFAULT gen_random_uuid(),PRIMARY KEY(user_id,request_id));
    CREATE TABLE ${prefix}_usage(user_id text,period_start date,used int CHECK(used>=0),PRIMARY KEY(user_id,period_start));`);
  }
 });
 afterAll(async()=>{if(state.db)await state.db.end();if(admin){await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}});
 for(const [prefix,charge,refund] of [['linqext',chargeRequest,refundRequest],['aztrade_ai',chargeTrade,refundTrade]] as const){
  it(`${prefix}: concurrent reservations never exceed allowance`,async()=>{
   const user=randomUUID(),ids=Array.from({length:20},()=>randomUUID()),attempt=randomUUID();
   for(const id of ids)await state.db.query(`INSERT INTO ${prefix}_requests(user_id,request_id,status,attempt_id) VALUES($1,$2,'running',$3)`,[user,id,attempt]);
   const results=await Promise.allSettled(ids.map(id=>charge(user,id,5,attempt)));
   expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(5);
   expect((await state.db.query(`SELECT used FROM ${prefix}_usage WHERE user_id=$1`,[user])).rows[0].used).toBe(5);
  });
  it(`${prefix}: a replaced attempt cannot charge or refund; recovery refunds once`,async()=>{
   const user=randomUUID(),id=randomUUID(),old=randomUUID(),fresh=randomUUID();
   await state.db.query(`INSERT INTO ${prefix}_requests(user_id,request_id,status,attempt_id) VALUES($1,$2,'running',$3)`,[user,id,old]);
   await charge(user,id,10,old);
   await state.db.query(`UPDATE ${prefix}_requests SET attempt_id=$3 WHERE user_id=$1 AND request_id=$2`,[user,id,fresh]);
   await expect(charge(user,id,10,old)).rejects.toThrow(/superseded/);
   await refund(user,id,old);
   expect((await state.db.query(`SELECT used FROM ${prefix}_usage WHERE user_id=$1`,[user])).rows[0].used).toBe(1);
   await state.db.query(`UPDATE ${prefix}_requests SET created_at=now()-interval '10 minutes' WHERE user_id=$1`,[user]);
   const db=await state.db.connect();try{await maintain(db);await maintain(db);}finally{db.release();}
   const row=(await state.db.query(`SELECT status,charged_period,attempt_id FROM ${prefix}_requests WHERE user_id=$1`,[user])).rows[0];
   expect(row.status).toBe('failed');expect(row.charged_period).toBeNull();expect(row.attempt_id).not.toBe(fresh);
   expect((await state.db.query(`SELECT used FROM ${prefix}_usage WHERE user_id=$1`,[user])).rows[0].used).toBe(0);
  });
 }
});
