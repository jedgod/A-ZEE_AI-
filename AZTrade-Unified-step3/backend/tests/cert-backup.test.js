import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {enabled,config,configPath,pools,closePools,provisionUser,createInstrument,placeOrder,reconcile} from './helpers/cert.js';
after(closePools);
test('logical backup restores fills, ledger and RLS into a separate database',{skip:!enabled||!config?.pgCtl||!config?.backupUrl},async()=>{
 const pg=(await import('pg')).default;
 const identity=await provisionUser();
 const symbol='BKP'+randomUUID().replaceAll('-','').slice(0,8).toUpperCase();   // own instrument: never alter shared seeded prices
 await createInstrument(symbol,'100');
 await placeOrder(identity,{symbol,side:'BUY',shares:'2',key:randomUUID()});
 assert.deepEqual(await reconcile(identity),[]);
 const name='aztrade_restore_'+randomUUID().replaceAll('-','');
 const admin=new pg.Client({connectionString:config.adminUrl}); await admin.connect();
 const archive=path.join(path.dirname(configPath),name+'.dump');
 const original=new URL(config.ownerUrl);
 const backup=new URL(config.backupUrl);   // dedicated read-only BYPASSRLS role: tables are FORCE RLS, so a normal owner dump is empty/refused
 const env={...process.env,PGHOST:backup.hostname,PGPORT:backup.port,PGUSER:decodeURIComponent(backup.username),PGPASSWORD:decodeURIComponent(backup.password),PGDATABASE:backup.pathname.slice(1)};
 const command=(exe,args,extra={})=>{
  const r=spawnSync(path.join(path.dirname(config.pgCtl),exe),args,{env:{...env,...extra},encoding:'utf8',windowsHide:true,timeout:60000});
  assert.equal(r.status,0,r.error?.message||r.stderr);
 };
 let restored;
 try {
  command('pg_dump.exe',['--format=custom','--file',archive]);
  await admin.query(`CREATE DATABASE ${name} OWNER ${original.username}`);
  command('pg_restore.exe',['--exit-on-error','--no-owner','--dbname',name,archive],{PGUSER:decodeURIComponent(original.username),PGPASSWORD:decodeURIComponent(original.password),PGDATABASE:name});
  const appUrl=new URL(config.appUrl);appUrl.pathname='/'+name;
  restored=new pg.Client({connectionString:appUrl.href});await restored.connect();
  assert.equal((await restored.query('SELECT * FROM users')).rowCount,0);
  await restored.query('BEGIN');
  await restored.query("SELECT set_config('app.current_user_id',$1,true),set_config('app.current_tenant',$2,true)",[identity.userId,identity.tenant]);
  assert.equal((await restored.query('SELECT cash::text FROM paper_accounts')).rows[0].cash,'99800.00000000');
  assert.deepEqual((await restored.query('SELECT * FROM aztrade_reconcile_paper_account($1)',[identity.accountId])).rows,[]);
  await restored.query('ROLLBACK');
 } finally {
  if(restored) await restored.end();
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);await admin.end();
  if(fs.existsSync(archive))fs.unlinkSync(archive);
 }
});
