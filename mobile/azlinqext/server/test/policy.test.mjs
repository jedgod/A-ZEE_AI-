import test from 'node:test';import assert from 'node:assert/strict';
import {TIERS,effectiveTier,trimContext,buildInstructions} from '../src/policy.mjs';
test('invalid and expired subscriptions fall back to free',()=>{assert.equal(effectiveTier({tier:'premium',status:'expired'}),'free');assert.equal(effectiveTier({tier:'premium',status:'active',period_end:'2020-01-01'}),'free');});
test('context is bounded per tier',()=>{const a=Array.from({length:20},(_,i)=>i);assert.equal(trimContext(a,'free').length,0);assert.equal(trimContext(a,'plus').length,5);assert.equal(trimContext(a,'premium').length,20);});
test('premium has more allowed variants and quota',()=>{assert.ok(TIERS.premium.variants>TIERS.plus.variants);assert.ok(TIERS.plus.limit>TIERS.free.limit);});
test('prompt explicitly rejects invented commitments',()=>{assert.match(buildInstructions('free','professional'),/Do not invent facts/);});
