import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { enabled, config, closePools, provisionUser, reconcile, snapshot, setQuote, createInstrument, toUnits } from './helpers/cert.js';

// The real paper router and the real request-scoped database middleware, with a test identity in place of the A-Zee
// verifier (which is a separate integration). Connects as the restricted application role.
const opts = { skip: !enabled };
const S = 'CRTH1';
let server, base, users = new Map(), requestDbPool;

test.before(async () => {
  if (!enabled) return;
  process.env.DATABASE_URL = config.appUrl;
  process.env.AZTRADE_PAPER_EXECUTION_CERTIFIED = 'true';                 // only inside this test process, never in .env
  const { requestDb } = await import('../lib/request-db.js');
  requestDbPool = (await import('../lib/db.js')).default;
  const { default: paper } = await import('../routes/paper.js');
  await createInstrument(S, '10');
  const app = express();
  app.use(express.json());
  // Test identity: the header carries a user id and tenant, exactly the shape the verified A-Zee claims will take.
  const testAuth = (req, res, next) => { req.user = { id: req.get('x-test-user'), tenant_id: req.get('x-test-tenant') }; next(); };
  app.use('/api/paper', testAuth, requestDb, paper);
  await new Promise(r => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { if (server) await new Promise(r => server.close(r)); if (requestDbPool) await requestDbPool.end(); await closePools(); });

const call = (u, method, path, body) => fetch(base + path, {
  method, headers: { 'content-type': 'application/json', 'x-test-user': u.userId, 'x-test-tenant': u.tenant },
  body: body ? JSON.stringify(body) : undefined,
}).then(async r => ({ status: r.status, body: await r.json() }));
const order = (u, over = {}) => call(u, 'POST', '/api/paper/orders', { symbol: S, side: 'BUY', shares: '2', idempotencyKey: `h-${randomUUID()}`, ...over });

test('a BUY returns 201, a retry with the same key returns 200 idempotent with the same order, a different payload returns 409', opts, async () => {
  const u = await provisionUser({ cash: '1000' }); await setQuote(S, '10');
  const k = `h-${randomUUID()}`;
  const first = await order(u, { idempotencyKey: k });
  assert.equal(first.status, 201);
  const again = await order(u, { idempotencyKey: k });
  assert.equal(again.status, 200); assert.equal(again.body.idempotent, true); assert.equal(again.body.order.id, first.body.order.id);
  assert.equal((await order(u, { idempotencyKey: k, shares: '3' })).status, 409);
  assert.equal(toUnits((await snapshot(u)).cash), toUnits('1000') - 20n * 10n ** 8n);
  assert.deepEqual(await reconcile(u), []);
});

test('requests are validated and refused with the right status codes', opts, async () => {
  const u = await provisionUser({ cash: '50' }); await setQuote(S, '10');
  assert.equal((await order(u, { side: 'HOLD' })).status, 400);
  assert.equal((await order(u, { shares: '0' })).status, 400);
  assert.equal((await order(u, { shares: '1.123456789' })).status, 400);
  assert.equal((await order(u, { idempotencyKey: 'short' })).status, 400);
  assert.equal((await order(u, { symbol: 'NOSUCH' })).status, 422);
  assert.equal((await order(u, { shares: '10' })).status, 422, 'insufficient cash');
  assert.equal((await order(u, { side: 'SELL', shares: '1' })).status, 422, 'insufficient position');
  assert.equal((await snapshot(u)).orders, 0);
});

test('20 parallel HTTP requests with one key produce one 201 and nineteen 200s of the same order', opts, async () => {
  const u = await provisionUser({ cash: '1000' }); await setQuote(S, '10');
  const k = `h-${randomUUID()}`;
  const rs = await Promise.all(Array.from({ length: 20 }, () => order(u, { idempotencyKey: k })));
  assert.equal(rs.filter(r => r.status === 201).length, 1);
  assert.equal(rs.filter(r => r.status === 200).length, 19);
  assert.equal(new Set(rs.map(r => r.body.order.id)).size, 1);
  assert.equal((await snapshot(u)).orders, 1);
  assert.deepEqual(await reconcile(u), []);
});

test('parallel HTTP orders cannot overspend', opts, async () => {
  const u = await provisionUser({ cash: '100' }); await setQuote(S, '10');
  const rs = await Promise.all(Array.from({ length: 30 }, () => order(u, { shares: '1' })));
  assert.equal(rs.filter(r => r.status === 201).length, 10);
  assert.equal(rs.filter(r => r.status === 422).length, 20);
  assert.equal(toUnits((await snapshot(u)).cash), 0n);
  assert.deepEqual(await reconcile(u), []);
});

test('a forged tenant claim is refused and a missing identity never reaches the database', opts, async () => {
  const a = await provisionUser({ cash: '1000' }), b = await provisionUser({ cash: '1000' }); await setQuote(S, '10');
  const forged = await call({ userId: b.userId, tenant: a.tenant }, 'POST', '/api/paper/orders', { symbol: S, side: 'BUY', shares: '1', idempotencyKey: `h-${randomUUID()}` });
  assert.equal(forged.status, 404);
  const none = await fetch(`${base}/api/paper/orders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ symbol: S, side: 'BUY', shares: '1', idempotencyKey: `h-${randomUUID()}` }) });
  assert.equal(none.status, 403);
  assert.equal((await snapshot(b)).orders, 0);
});

test('the account view returns exact decimals and only the caller\'s own data', opts, async () => {
  const a = await provisionUser({ cash: '1000' }), b = await provisionUser({ cash: '5' }); await setQuote(S, '10');
  await order(a, { shares: '3' });
  const view = await call(a, 'GET', '/api/paper/');
  assert.equal(view.status, 200);
  assert.equal(toUnits(view.body.cash), toUnits('970'));
  assert.equal(view.body.history.length, 1);
  const other = await call(b, 'GET', '/api/paper/');
  assert.equal(other.body.history.length, 0);
});
