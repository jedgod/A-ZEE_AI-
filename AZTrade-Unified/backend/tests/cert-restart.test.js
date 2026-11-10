import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { enabled, config, pools, closePools, provisionUser, placeOrder, reconcile, snapshot, setQuote, createInstrument,
  hashOrder, toUnits, sleep, waitForServer, inContext } from './helpers/cert.js';

// Restart and crash recovery against the real database. These tests STOP AND RESTART the disposable PostgreSQL
// server (pg_ctl restart -m immediate is an abort: the next start performs real crash recovery).
const canControl = enabled && Boolean(config.pgCtl && config.dataDir);
const opts = { skip: !canControl && 'requires AZTRADE_CERT_PGCTL / AZTRADE_CERT_DATADIR in the certification config' };
const key = () => `r-${randomUUID()}`;
const S = 'CRTR1';

test.before(async () => { if (enabled) await createInstrument(S, '10'); });
test.after(closePools);

function restart(mode) {
  return new Promise((resolve, reject) => {
    const p = spawn(config.pgCtl, ['-D', config.dataDir, 'restart', '-m', mode, '-w', '-t', '90'], { stdio: 'ignore' });
    p.on('error', reject);
    p.on('exit', code => (code === 0 ? resolve() : reject(new Error(`pg_ctl restart exited ${code}`))));
  });
}
const startTime = async () => (await pools.owner.query('SELECT pg_postmaster_start_time() AS t')).rows[0].t.getTime();

/** Retries one order (same key, same payload) until the database answers; a dead pooled connection may fail the first tries. */
async function retryUntilAnswered(u, o, attempts = 40) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try { return { result: await placeOrder(u, o), attempts: i + 1 }; }
    catch (e) {
      last = e;
      if (e.code && /^T000/.test(e.code)) throw e;       // a real business answer (refused), not an outage
      await sleep(400);
    }
  }
  throw last;
}

test('a client that dies mid-transaction leaves nothing behind, and the retry posts exactly once', opts, async () => {
  const u = await provisionUser({ cash: '1000' });
  await setQuote(S, '10');
  const k = key();
  const c = new pg.Client({ connectionString: config.appUrl });
  c.on('error', () => {});
  await c.connect();
  await c.query('BEGIN');
  await c.query("SELECT set_config('app.current_user_id', $1, true)", [u.userId]);
  await c.query("SELECT set_config('app.current_tenant', $1, true)", [u.tenant]);
  const { rows } = await c.query('SELECT aztrade_place_paper_order($1,$2,$3::numeric,$4,$5) AS r', [S, 'BUY', '4', k, hashOrder(S, 'BUY', '4')]);
  assert.equal(rows[0].r.replay, false, 'the order was fully executed inside the open transaction');
  c.connection.stream.destroy();                          // the process "crashes" before COMMIT
  await sleep(1500);
  const after = await snapshot(u);
  assert.equal(after.orders, 0, 'uncommitted work must vanish');
  assert.equal(toUnits(after.cash), toUnits('1000'));
  const retry = await placeOrder(u, { symbol: S, side: 'BUY', shares: '4', key: k });
  assert.equal(retry.replay, false);
  assert.equal((await snapshot(u)).orders, 1);
  assert.deepEqual(await reconcile(u), []);
});

test('a lost acknowledgement after COMMIT: the retry replays the same order and posts nothing twice', opts, async () => {
  const u = await provisionUser({ cash: '1000' });
  await setQuote(S, '10');
  const k = key();
  const committed = await placeOrder(u, { symbol: S, side: 'BUY', shares: '2', key: k });   // the caller "never sees" this answer
  void committed;
  const again = await placeOrder(u, { symbol: S, side: 'BUY', shares: '2', key: k });
  assert.equal(again.replay, true);
  assert.equal(again.order.id, committed.order.id);
  const snap = await snapshot(u);
  assert.equal(snap.orders, 1); assert.equal(snap.ledger, 2);
  assert.equal(toUnits(snap.cash), toUnits('1000') - 20n * 10n ** 8n);
  assert.deepEqual(await reconcile(u), []);
});

test('uncommitted work disappears when the SERVER crashes; committed work survives crash recovery', opts, async () => {
  const u = await provisionUser({ cash: '1000' });
  await setQuote(S, '10');
  await placeOrder(u, { symbol: S, side: 'BUY', shares: '3', key: key() });                // committed before the crash
  const before = await snapshot(u);

  const inflight = new pg.Client({ connectionString: config.appUrl });
  inflight.on('error', () => {});
  await inflight.connect();
  await inflight.query('BEGIN');
  await inflight.query("SELECT set_config('app.current_user_id', $1, true)", [u.userId]);
  await inflight.query("SELECT set_config('app.current_tenant', $1, true)", [u.tenant]);
  await inflight.query('SELECT aztrade_place_paper_order($1,$2,$3::numeric,$4,$5)', [S, 'BUY', '5', key(), hashOrder(S, 'BUY', '5')]);

  const bootBefore = await startTime();
  await restart('immediate');                                                             // abort: forces crash recovery
  await waitForServer(config.appUrl);
  assert.ok(await startTime() > bootBefore, 'the server really restarted');
  await inflight.end().catch(() => {});

  const afterCrash = await retryUntilAnswered(u, { symbol: S, side: 'BUY', shares: '1', key: key() }).then(r => r.result);
  assert.equal(afterCrash.replay, false);
  const snap = await snapshot(u);
  assert.equal(snap.orders, before.orders + 1, 'the in-flight order is gone; only the committed one and the new one exist');
  assert.equal(toUnits(snap.cash), toUnits(before.cash) - 10n * 10n ** 8n);
  assert.deepEqual(await reconcile(u), []);
});

test('crash in the middle of a parallel storm: every acknowledged order survives, every key ends up posted exactly once, books reconcile', opts, async () => {
  const u = await provisionUser({ cash: '100000' });
  await setQuote(S, '10');
  const acked = new Map();                                                                // key -> order id, only what the caller saw
  const keysBefore = Array.from({ length: 10 }, key);
  for (const k of keysBefore) acked.set(k, (await placeOrder(u, { symbol: S, side: 'BUY', shares: '1', key: k })).order.id);

  const storm = Array.from({ length: 80 }, () => ({ symbol: S, side: 'BUY', shares: '1', key: key() }));
  const bootBefore = await startTime();
  const running = storm.map(o => placeOrder(u, o).then(r => { acked.set(o.key, r.order.id); }, () => { /* outage: retried below */ }));
  await sleep(120);
  const crashed = restart('immediate');                                                   // abort while orders are in flight
  await crashed;
  await waitForServer(config.appUrl);
  await Promise.allSettled(running);
  assert.ok(await startTime() > bootBefore, 'the server really restarted');

  // The client retries every key it never got an answer for, with the same payload.
  const retried = await Promise.all(storm.filter(o => !acked.has(o.key)).map(o => retryUntilAnswered(u, o)));
  for (const r of retried) acked.set(r.result.order.idempotency_key, r.result.order.id);

  const snap = await snapshot(u);
  const total = keysBefore.length + storm.length;
  assert.equal(snap.orders, total, 'every key is posted exactly once: none lost, none doubled');
  assert.equal(snap.ledger, total * 2);
  assert.equal(toUnits(snap.cash), toUnits('100000') - BigInt(total) * 10n * 10n ** 8n);
  // Everything the caller was told about before the crash is still there with the same order id.
  // Read through the account's own context: row-level security is forced even for the owner, so a context-free read sees nothing.
  const { rows } = await inContext(pools.app, u, c => c.query('SELECT id FROM paper_orders WHERE account_id = $1', [u.accountId]));
  const present = new Set(rows.map(r => r.id));
  for (const [k, id] of acked) if (k) assert.ok(present.has(id), `acknowledged order ${id} was lost`);
  assert.deepEqual(await reconcile(u), []);
});

test('a graceful restart keeps everything, and the application pool recovers by itself', opts, async () => {
  const u = await provisionUser({ cash: '1000' });
  await setQuote(S, '10');
  await placeOrder(u, { symbol: S, side: 'BUY', shares: '1', key: key() });
  const before = await snapshot(u);
  await restart('fast');
  await waitForServer(config.appUrl);
  const recovered = await retryUntilAnswered(u, { symbol: S, side: 'BUY', shares: '1', key: key() });
  assert.ok(recovered.attempts <= 5, `the pool took ${recovered.attempts} attempts to recover`);
  const snap = await snapshot(u);
  assert.equal(snap.orders, before.orders + 1);
  assert.deepEqual(await reconcile(u), []);
});

test('the API process survives a database crash during in-flight HTTP requests, answers every one, and retries post each order exactly once', opts, async () => {
  // Real router + real request-db middleware, restricted application role. If a checked-out connection's 'error' event were
  // unhandled (the defect this guards against), Node would raise an uncaught exception and this test process would die.
  const { startApi } = await import('./helpers/api.js');
  const api = await startApi();
  try {
    const u = await provisionUser({ cash: '100000' });
    await setQuote(S, '10');
    const orders = Array.from({ length: 40 }, () => ({ symbol: S, side: 'BUY', shares: '1', idempotencyKey: `h-${randomUUID()}` }));
    const done = new Map();                                              // key -> final HTTP status once answered 200/201
    const first = orders.map(o => api.call(u, 'POST', '/api/paper/orders', o).then(r => { if ([200, 201].includes(r.status)) done.set(o.idempotencyKey, r.status); return r.status; }, () => 'network'));
    await sleep(100);
    await restart('immediate');                                          // abort the database while requests are in flight
    await waitForServer(config.appUrl);
    const statuses = await Promise.all(first);
    for (const s of statuses) assert.ok([200, 201, 500, 503, 'network'].includes(s), `unexpected status ${s}`);

    // The caller retries everything it was not told succeeded, with the SAME key. The API must have recovered by itself.
    for (const o of orders.filter(o => !done.has(o.idempotencyKey))) {
      let r;
      for (let i = 0; i < 40; i++) {
        r = await api.call(u, 'POST', '/api/paper/orders', o).catch(() => ({ status: 'network' }));
        if ([200, 201].includes(r.status)) break;
        assert.ok([500, 503, 'network'].includes(r.status), `a retry got ${r.status}: ${JSON.stringify(r.body)}`);
        await sleep(300);
      }
      assert.ok([200, 201].includes(r.status), 'the API never recovered after the database restart');
    }
    const snap = await snapshot(u);
    assert.equal(snap.orders, 40, 'every key is posted exactly once');
    assert.equal(snap.ledger, 80);
    assert.equal(toUnits(snap.cash), toUnits('100000') - 400n * 10n ** 8n);
    assert.deepEqual(await reconcile(u), []);
  } finally { await api.stop(); }
});
