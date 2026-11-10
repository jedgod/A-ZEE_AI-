import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {enabled,pools,closePools,inContext} from './helpers/cert.js';
after(closePools);
const provision=(subject,tenant,tier='plus')=>pools.app.query('SELECT * FROM aztrade_provision_identity($1,$2,$3)',[subject,tenant,tier]);
test('parallel identity provisioning is idempotent under FORCE RLS', {skip:!enabled},async()=>{
 const subject=randomUUID(),tenant=randomUUID();
 const rows=await Promise.all(Array.from({length:20},()=>provision(subject,tenant)));
 const id=rows[0].rows[0].id;
 assert.ok(rows.every(r=>r.rows[0].id===id));
 await inContext(pools.app,{userId:id,tenant},async c=>{
  assert.equal((await c.query('SELECT count(*)::int n FROM paper_accounts')).rows[0].n,1);
  assert.equal((await c.query('SELECT count(*)::int n FROM portfolios')).rows[0].n,1);
 });
 assert.equal((await pools.app.query('SELECT * FROM users')).rowCount,0,'no identity context leaked');
 await assert.rejects(()=>pools.app.query('SELECT * FROM aztrade_identity_index'),/permission denied/);
 await assert.rejects(()=>provision(subject,'other'),/tenant reassignment/);
 assert.equal((await provision(subject,tenant,'free')).rows[0].tier,'free');
});
test('provisioning validates all identity fields and preserves cross-tenant isolation',{skip:!enabled},async()=>{
 await assert.rejects(()=>provision(randomUUID(),randomUUID(),null),/Invalid identity/);
 const a=(await provision(randomUUID(),randomUUID())).rows[0];
 const b=(await provision(randomUUID(),randomUUID())).rows[0];
 await inContext(pools.app,{userId:a.id,tenant:a.tenant_id},async c=>{
  assert.equal((await c.query('SELECT * FROM users WHERE id=$1',[b.id])).rowCount,0);
  assert.equal((await c.query('SELECT * FROM paper_accounts WHERE user_id=$1',[b.id])).rowCount,0);
 });
});
