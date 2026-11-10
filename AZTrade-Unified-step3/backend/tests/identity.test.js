import test from 'node:test';
import assert from 'node:assert/strict';
import {mapPlan} from '../lib/plans.js';
test('only active subscription can grant tier',()=>{
 assert.equal(mapPlan('premium','canceled'),'free');
 assert.equal(mapPlan('plus','active'),'plus');
 assert.equal(mapPlan('premium','trialing'),'premium');
 assert.equal(mapPlan('unknown','active'),'free');
});
