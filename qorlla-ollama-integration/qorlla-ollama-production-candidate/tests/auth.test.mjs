import test from 'node:test';import assert from 'node:assert/strict';import {createAuthority} from '../src/auth.mjs';
test('authority requires live session, tenant, subscription and entitlement',async()=>{
 const good={active:true,session_active:true,member_active:true,tenant_active:true,subscription_active:true,entitled:true,tenant_id:'a',subject_id:'b'};
 const verify=createAuthority({url:'https://auth.internal.example/validate',serviceToken:'service',fetchImpl:async()=>({ok:true,json:async()=>good})});
 assert.deepEqual(await verify('Bearer abcdefghijklmnop'),{tenant:'a',subject:'b'});
 const denied=createAuthority({url:'https://auth.internal.example/validate',serviceToken:'service',fetchImpl:async()=>({ok:true,json:async()=>({...good,subscription_active:false})})});
 await assert.rejects(()=>denied('Bearer abcdefghijklmnop'));
});
