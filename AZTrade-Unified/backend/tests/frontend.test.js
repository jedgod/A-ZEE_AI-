import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {mapPlan} from '../lib/plans.js';
const source = readFileSync(new URL('../../frontend/app.js', import.meta.url), 'utf8');
test('billing tiers match A-Zee and reject unknown/prototype names', () => {
 for (const plan of ['pro','business','enterprise','premium']) assert.equal(mapPlan(plan,'active'),'premium');
 for (const plan of ['go','plus']) assert.equal(mapPlan(plan,'trialing'),'plus');
 for (const plan of ['constructor','toString','unknown']) assert.equal(mapPlan(plan,'active'),'free');
 assert.equal(mapPlan('pro','canceled'),'free');
});
test('frontend renders hostile API text without HTML and retries the identical order', async () => {
 const elements = new Map();
 const document = {getElementById(id) {
  if (!elements.has(id)) elements.set(id, {textContent:'',disabled:false,listeners:{},addEventListener(type, fn){this.listeners[type]=fn;},set innerHTML(value){throw new Error('HTML sink used');}});
  return elements.get(id);
 }};
 const orders = []; let fail = true;
 const context = vm.createContext({document, AbortSignal, crypto:{randomUUID:()=> 'test-order-123'}, FormData:class {get(k){return {symbol:'AAPL',side:'BUY',shares:'1'}[k];}}, fetch:async (path, options) => {
  if (path.endsWith('/token')) return {ok:true,json:async()=>({access_token:'test'})};
  if (path.endsWith('/orders')) { orders.push(options.body); if (fail) {fail=false; throw new Error('connection lost');} return {ok:true,json:async()=>({order:'confirmed'})}; }
  return {ok:true,json:async()=>({accountId:'account-1',cash:'<img src=x onerror=alert(1)>'})};
 }});
 vm.runInContext(source, context);
 await elements.get('connect').listeners.click();
 assert.match(elements.get('account').textContent, /<img/);
 elements.get('order').listeners.submit({preventDefault(){},currentTarget:{}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(elements.get('retry').disabled,false);
 elements.get('retry').listeners.click();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(orders.length,2); assert.equal(orders[0],orders[1]);
 assert.equal(elements.get('retry').disabled,true);
 assert.match(elements.get('result').textContent,/confirmed/);
});
