// End-to-end check of the billing webhook against a temporary second app server (port 3001)
// that receives BILLING_WEBHOOK_SECRET through its process environment only. The local account's
// subscriptions are snapshotted first and restored afterwards.   npm run check:billing
const assert = require('node:assert/strict');
const { createHmac, randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
require('@next/env').loadEnvConfig(process.cwd());
const { Client } = require('pg');

const secret = randomBytes(32).toString('hex');
const base = 'http://localhost:3001';
const tag = randomBytes(4).toString('hex');

async function waitFor(url) {
  for (let i = 0; i < 60; i++) { try { await fetch(url); return; } catch { await new Promise(r => setTimeout(r, 500)); } }
  throw new Error('server did not start');
}
const send = (event, signature) => {
  const raw = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  return fetch(base + '/api/webhooks/billing', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Billing-Signature': signature ?? `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}` }, body: raw,
  }).then(async r => ({ status: r.status, json: await r.json() }));
};
const access = () => fetch(base + '/api/me/access').then(r => r.json()).then(j => j.data.plan);

(async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const user = (await db.query('SELECT id, email, plan FROM users WHERE is_local')).rows[0];
  assert.ok(user, 'needs the local account (npm run account:seed)');
  const snapshot = (await db.query('SELECT * FROM subscriptions WHERE user_id = $1', [user.id])).rows;
  const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', 'localhost', '--port', '3001'],
    { env: { ...process.env, BILLING_WEBHOOK_SECRET: secret, APP_ORIGIN: base }, stdio: 'ignore' });
  try {
    const unconfigured = await fetch('http://localhost:3000/api/webhooks/billing', { method: 'POST', body: '{}' });
    assert.equal(unconfigured.status, 503, 'disabled without a secret');
    await waitFor(base + '/api/me/access');
    const before = await access();
    console.log(`PASS webhook disabled without a secret; current plan ${before}`);

    const activated = { id: `evt_check_${tag}_1`, type: 'subscription.activated', data: { email: user.email, planId: 'pro25', providerSubscriptionId: `sub_check_${tag}`, providerCustomerId: 'cus_check', billing: 'monthly', pricePaid: 25, currentPeriodEnd: new Date(Date.now() + 30 * 864e5).toISOString() } };
    assert.equal((await send(activated, 't=1,v1=' + '0'.repeat(64))).status, 400, 'bad signature');
    assert.equal((await send({ ...activated, id: 'x' }, `t=${Math.floor(Date.now() / 1000) - 900},v1=${'0'.repeat(64)}`)).status, 400, 'stale timestamp');
    const ok = await send(activated);
    assert.deepEqual(ok.json, { received: true, duplicate: false });
    assert.equal(await access(), 'pro25');
    assert.deepEqual((await send(activated)).json, { received: true, duplicate: true });
    assert.equal((await db.query("SELECT count(*)::int n FROM subscriptions WHERE provider_subscription_id = $1", [`sub_check_${tag}`])).rows[0].n, 1);
    console.log('PASS signed activation upgrades the plan; forged, stale, and duplicate events are refused or ignored');

    assert.equal((await send({ id: `evt_check_${tag}_2`, type: 'subscription.past_due', data: { email: user.email, planId: 'pro25', providerSubscriptionId: `sub_check_${tag}` } })).status, 200);
    assert.equal(await access(), 'free', 'past due loses paid access');
    assert.equal((await send({ id: `evt_check_${tag}_3`, type: 'subscription.updated', data: { email: user.email, planId: 'pro60', status: 'active', providerSubscriptionId: `sub_check_${tag}` } })).status, 200);
    assert.equal(await access(), 'pro60');
    assert.equal((await send({ id: `evt_check_${tag}_4`, type: 'subscription.canceled', data: { email: user.email, planId: 'pro60', providerSubscriptionId: `sub_check_${tag}` } })).status, 200);
    assert.equal(await access(), 'free');
    assert.equal((await send({ id: `evt_check_${tag}_5`, type: 'subscription.activated', data: { email: `nobody-${tag}@x.invalid`, planId: 'plus', providerSubscriptionId: `sub_check_${tag}_b` } })).status, 422);
    console.log('PASS past due, upgrade, and cancellation change access; unknown accounts are rejected');
  } finally {
    server.kill();
    await db.query('DELETE FROM subscriptions WHERE user_id = $1', [user.id]);
    for (const row of snapshot) {
      const cols = Object.keys(row);
      await db.query(`INSERT INTO subscriptions (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})`, cols.map(c => row[c]));
    }
    await db.query('UPDATE users SET plan = $2 WHERE id = $1', [user.id, user.plan]);
    await db.query("DELETE FROM billing_events WHERE id LIKE $1", [`evt_check_${tag}%`]);
    await db.end();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
