import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { enabled, pools, closePools, provisionUser, placeOrder, reconcile, snapshot, setQuote, createInstrument,
  expectedState, toUnits } from './helpers/cert.js';

// Concurrent order execution against the real database with the restricted application role.
const opts = { skip: !enabled };
const key = () => `c-${randomUUID()}`;
const S = 'CRTC1';
const T = 'CRTC2';

test.before(async () => { if (enabled) { await createInstrument(S, '10'); await createInstrument(T, '7.77777777'); } });
test.after(closePools);

const settle = promises => Promise.allSettled(promises);
const codes = results => results.map(r => (r.status === 'fulfilled' ? (r.value.replay ? 'replay' : 'ok') : r.reason.code ?? r.reason.message));
const count = (results, c) => codes(results).filter(x => x === c).length;
function assertNoDeadlocks(results) {
  for (const r of results) if (r.status === 'rejected') assert.ok(!['40P01', '40001', '55P03'].includes(r.reason.code), `unexpected concurrency error ${r.reason.code}: ${r.reason.message}`);
}

test('40 parallel BUYs with cash for exactly 25: exactly 25 fill, 15 are refused, never overspent', opts, async () => {
  const u = await provisionUser({ cash: '250' });                 // 25 shares at 10
  await setQuote(S, '10');
  const results = await settle(Array.from({ length: 40 }, () => placeOrder(u, { symbol: S, side: 'BUY', shares: '1', key: key() })));
  assertNoDeadlocks(results);
  assert.equal(count(results, 'ok'), 25);
  assert.equal(count(results, 'T0006'), 15);
  const snap = await snapshot(u);
  assert.equal(toUnits(snap.cash), 0n, 'all cash spent, none overspent');
  assert.equal(snap.orders, 25); assert.equal(snap.ledger, 50);
  assert.deepEqual(snap.positions.map(p => [p.symbol, toUnits(p.shares)]), [[S, toUnits('25')]]);
  assert.deepEqual(await reconcile(u), []);
});

test('30 parallel SELLs of 1 share with 10 held: exactly 10 fill, 20 are refused, never oversold', opts, async () => {
  const u = await provisionUser({ cash: '1000' });
  await setQuote(S, '10');
  await placeOrder(u, { symbol: S, side: 'BUY', shares: '10', key: key() });
  const results = await settle(Array.from({ length: 30 }, () => placeOrder(u, { symbol: S, side: 'SELL', shares: '1', key: key() })));
  assertNoDeadlocks(results);
  assert.equal(count(results, 'ok'), 10);
  assert.equal(count(results, 'T0007'), 20);
  const snap = await snapshot(u);
  assert.deepEqual(snap.positions, []);
  assert.equal(toUnits(snap.cash), toUnits('1000'), 'bought and sold at one price: back to the opening cash exactly');
  assert.deepEqual(await reconcile(u), []);
});

test('20 parallel requests with the SAME key and payload produce one fill and 19 replays of that same order', opts, async () => {
  const u = await provisionUser({ cash: '1000' });
  await setQuote(S, '10');
  const k = key();
  const results = await settle(Array.from({ length: 20 }, () => placeOrder(u, { symbol: S, side: 'BUY', shares: '3', key: k })));
  assertNoDeadlocks(results);
  assert.equal(count(results, 'ok'), 1);
  assert.equal(count(results, 'replay'), 19);
  assert.equal(new Set(results.map(r => r.value.order.id)).size, 1, 'every caller is told about the same order');
  const snap = await snapshot(u);
  assert.equal(snap.orders, 1); assert.equal(snap.ledger, 2);
  assert.equal(toUnits(snap.cash), toUnits('1000') - 30n * 10n ** 8n);
  assert.deepEqual(await reconcile(u), []);
});

test('parallel requests with the SAME key but DIFFERENT payloads: exactly one payload wins, the rest are refused', opts, async () => {
  const u = await provisionUser({ cash: '10000' });
  await setQuote(S, '10');
  const k = key();
  const sizes = ['1', '2', '3', '4', '5', '6'];
  const results = await settle(sizes.flatMap(s => [placeOrder(u, { symbol: S, side: 'BUY', shares: s, key: k }), placeOrder(u, { symbol: S, side: 'BUY', shares: s, key: k })]));
  assertNoDeadlocks(results);
  assert.equal(count(results, 'ok'), 1, 'exactly one request creates the order');
  const winner = results.find(r => r.status === 'fulfilled' && !r.value.replay).value.order;
  assert.equal(count(results, 'replay'), 1, 'only the winner\'s twin may replay');
  assert.equal(count(results, 'T0003'), sizes.length * 2 - 2, 'every other payload is refused');
  const snap = await snapshot(u);
  assert.equal(snap.orders, 1);
  assert.equal(toUnits(snap.cash), toUnits('10000') - toUnits(winner.shares) * 10n);
  assert.deepEqual(await reconcile(u), []);
});

test('interleaved BUYs and SELLs of two symbols keep every invariant', opts, async () => {
  const u = await provisionUser({ cash: '5000' });
  await setQuote(S, '10'); await setQuote(T, '7.77777777');
  await placeOrder(u, { symbol: S, side: 'BUY', shares: '20', key: key() });
  const ops = [];
  for (let i = 0; i < 40; i++) {
    ops.push({ symbol: i % 2 ? S : T, side: i % 3 === 0 ? 'SELL' : 'BUY', shares: String(1 + (i % 4)), key: key() });
  }
  const results = await settle(ops.map(o => placeOrder(u, o)));
  assertNoDeadlocks(results);
  // Independent replay of exactly the orders that were accepted, in the order the database serialised them.
  const accepted = results.filter(r => r.status === 'fulfilled').map(r => r.value.order)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  const fills = [{ symbol: S, side: 'BUY', shares: '20', price: '10' }, ...accepted.map(o => ({ symbol: o.symbol, side: o.side, shares: o.shares, price: o.price }))];
  const expected = expectedState('5000', fills);
  const snap = await snapshot(u);
  assert.equal(toUnits(snap.cash), toUnits(expected.cash), 'cash equals the independent recomputation');
  assert.deepEqual(snap.positions.map(p => [p.symbol, toUnits(p.shares)]), expected.positions.map(p => [p.symbol, toUnits(p.shares)]));
  assert.ok(toUnits(snap.cash) >= 0n);
  assert.deepEqual(await reconcile(u), []);
});

test('two tenants trading concurrently never affect each other', opts, async () => {
  const [a, b] = await Promise.all([provisionUser({ cash: '1000' }), provisionUser({ cash: '1000' })]);
  await setQuote(S, '10');
  const batch = u => Array.from({ length: 30 }, () => placeOrder(u, { symbol: S, side: 'BUY', shares: '1', key: key() }));
  const results = await settle([...batch(a), ...batch(b)]);
  assertNoDeadlocks(results);
  assert.equal(count(results, 'ok'), 60, 'each tenant has cash for all of its own orders');
  for (const u of [a, b]) {
    const snap = await snapshot(u);
    assert.equal(snap.orders, 30);
    assert.equal(toUnits(snap.cash), toUnits('1000') - 300n * 10n ** 8n);
    assert.deepEqual(await reconcile(u), []);
  }
});

test('storm: 400 random orders over 6 accounts with 24 connections — no deadlocks, no overspend, every account reconciles', opts, async () => {
  await setQuote(S, '10'); await setQuote(T, '7.77777777');
  const users = await Promise.all(Array.from({ length: 6 }, () => provisionUser({ cash: '2000' })));
  const rnd = (() => { let s = 12345; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();   // deterministic
  const ops = Array.from({ length: 400 }, () => {
    const u = users[Math.floor(rnd() * users.length)];
    return { u, o: { symbol: rnd() < 0.5 ? S : T, side: rnd() < 0.6 ? 'BUY' : 'SELL', shares: (1 + Math.floor(rnd() * 5)).toString(), key: key() } };
  });
  const results = await settle(ops.map(({ u, o }) => placeOrder(u, o)));
  assertNoDeadlocks(results);
  const unexpected = codes(results).filter(c => !['ok', 'T0006', 'T0007'].includes(c));
  assert.deepEqual(unexpected, [], 'only fills, insufficient-cash and insufficient-position outcomes are expected');
  for (const u of users) {
    const snap = await snapshot(u);
    assert.ok(toUnits(snap.cash) >= 0n, 'cash never negative');
    assert.ok(snap.positions.every(p => toUnits(p.shares) > 0n), 'no empty or negative position rows');
    assert.deepEqual(await reconcile(u), [], `account ${u.accountId} must reconcile`);
  }
});
