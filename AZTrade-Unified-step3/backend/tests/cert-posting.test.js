import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { enabled, pools, closePools, provisionUser, placeOrder, reconcile, snapshot, setQuote, createInstrument,
  inContext, expectedState, notionalUnits, toUnits } from './helpers/cert.js';

// Balanced postings, exact arithmetic, opening-balance reconciliation, idempotency, validation and the privilege boundary.
// Runs only against the disposable instance (AZTRADE_CERT_CONFIG + AZTRADE_CERT_DISPOSABLE=YES).
const opts = { skip: !enabled };
const key = () => `k-${randomUUID()}`;
const S = 'CRTP1';

test.before(async () => { if (enabled) { await createInstrument(S, '123.45678901'); await createInstrument('CRTTIE', '0.00000001'); } });
test.after(closePools);

async function expectRejected(promise, code) {
  await assert.rejects(promise, e => { assert.equal(e.code, code, `expected SQLSTATE ${code}, got ${e.code}: ${e.message}`); return true; });
}

test('a BUY posts a balanced pair, moves cash by the exact rounded notional, and reconciles to the opening balance', opts, async () => {
  const u = await provisionUser({ cash: '100000' });
  const price = '123.45678901';
  const shares = '3.5';
  await setQuote(S, price);
  const res = await placeOrder(u, { symbol: S, side: 'BUY', shares, key: key() });
  assert.equal(res.replay, false);
  const expected = expectedState('100000', [{ symbol: S, side: 'BUY', shares, price }]);
  const snap = await snapshot(u);
  assert.equal(toUnits(snap.cash), toUnits(expected.cash), 'cash must equal opening minus the exact rounded notional');
  assert.deepEqual(snap.positions.map(p => [p.symbol, toUnits(p.shares)]), expected.positions.map(p => [p.symbol, toUnits(p.shares)]));
  const n = notionalUnits(shares, price);
  await inContext(pools.app, u, async c => {
    const { rows } = await c.query('SELECT entry_type, account_code, amount::text AS amount FROM paper_ledger WHERE order_id = $1 ORDER BY entry_type', [res.order.id]);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map(r => r.entry_type).sort(), ['credit', 'debit']);
    for (const r of rows) assert.equal(toUnits(r.amount), n, 'both ledger entries carry the same single-rounded amount');
  });
  assert.deepEqual(await reconcile(u), [], 'reconciliation must return no violations');
});

test('SELL reduces then closes the position, returns cash exactly, and still reconciles', opts, async () => {
  const u = await provisionUser({ cash: '50000' });
  await setQuote(S, '10.5');
  await placeOrder(u, { symbol: S, side: 'BUY', shares: '10', key: key() });
  await placeOrder(u, { symbol: S, side: 'SELL', shares: '4', key: key() });
  let snap = await snapshot(u);
  assert.deepEqual(snap.positions.map(p => [p.symbol, toUnits(p.shares)]), [[S, toUnits('6')]]);
  await placeOrder(u, { symbol: S, side: 'SELL', shares: '6', key: key() });
  snap = await snapshot(u);
  assert.deepEqual(snap.positions, [], 'a fully sold position row is removed');
  assert.equal(toUnits(snap.cash), toUnits('50000'), 'buying and selling at one price returns exactly the opening cash');
  assert.deepEqual(await reconcile(u), []);
});

test('sub-unit rounding ties: cash and ledger use the same single rounding', opts, async () => {
  const u = await provisionUser({ cash: '1000' });
  // 0.5 shares * 0.00000001 = 5e-9: an exact tie at the 9th decimal. Both cash and ledger must round it the same way.
  const res = await placeOrder(u, { symbol: 'CRTTIE', side: 'BUY', shares: '0.5', key: key() });
  const n = notionalUnits('0.5', '0.00000001');
  assert.equal(n, 1n, 'the independent calculation rounds the tie up to 1e-8');
  const snap = await snapshot(u);
  assert.equal(toUnits(snap.cash), toUnits('1000') - n);
  assert.deepEqual(await reconcile(u), []);
  // An order too small to be worth one unit is refused, not posted as zero.
  await expectRejected(placeOrder(u, { symbol: 'CRTTIE', side: 'BUY', shares: '0.00000001', key: key() }), 'T0008');
  assert.equal(res.order.status, 'filled');
});

test('the same key and payload replays the same order and posts nothing twice', opts, async () => {
  const u = await provisionUser({ cash: '5000' });
  await setQuote(S, '20');
  const k = key();
  const first = await placeOrder(u, { symbol: S, side: 'BUY', shares: '5', key: k });
  const second = await placeOrder(u, { symbol: S, side: 'BUY', shares: '5', key: k });
  assert.equal(first.replay, false); assert.equal(second.replay, true);
  assert.equal(second.order.id, first.order.id);
  const snap = await snapshot(u);
  assert.equal(snap.orders, 1); assert.equal(snap.ledger, 2);
  assert.equal(toUnits(snap.cash), toUnits('5000') - notionalUnits('5', '20'));
  assert.deepEqual(await reconcile(u), []);
});

test('the same key with a different payload is refused and changes nothing', opts, async () => {
  const u = await provisionUser({ cash: '5000' });
  await setQuote(S, '20');
  const k = key();
  await placeOrder(u, { symbol: S, side: 'BUY', shares: '5', key: k });
  const before = await snapshot(u);
  await expectRejected(placeOrder(u, { symbol: S, side: 'BUY', shares: '6', key: k }), 'T0003');
  await expectRejected(placeOrder(u, { symbol: S, side: 'SELL', shares: '5', key: k }), 'T0003');
  assert.deepEqual(await snapshot(u), before);
});

test('invalid input is refused before anything is written', opts, async () => {
  const u = await provisionUser({ cash: '5000' });
  await setQuote(S, '20');
  const before = await snapshot(u);
  const bad = [
    { symbol: S, side: 'HOLD', shares: '1', key: key() },
    { symbol: S, side: 'BUY', shares: '0', key: key() },
    { symbol: S, side: 'BUY', shares: '-1', key: key() },
    { symbol: S, side: 'BUY', shares: '1.123456789', key: key() },     // 9 decimals
    { symbol: S, side: 'BUY', shares: '1000000', key: key() },          // over the cap
    { symbol: S, side: 'BUY', shares: '1', key: 'short' },
    { symbol: "x'; DROP TABLE users;--", side: 'BUY', shares: '1', key: key() },
  ];
  for (const b of bad) await expectRejected(placeOrder(u, b), 'T0008');
  assert.deepEqual(await snapshot(u), before);
});

test('unknown instruments and stale or future quotes are refused', opts, async () => {
  const u = await provisionUser({ cash: '5000' });
  const before = await snapshot(u);
  await expectRejected(placeOrder(u, { symbol: 'NOSUCHSYM', side: 'BUY', shares: '1', key: key() }), 'T0004');
  await setQuote(S, '20', 16 * 60);                                   // 16 minutes old
  await expectRejected(placeOrder(u, { symbol: S, side: 'BUY', shares: '1', key: key() }), 'T0005');
  // A quote more than 60 seconds in the future cannot even be stored (migration 003's constraint); the procedure re-checks anyway.
  await assert.rejects(setQuote(S, '20', -120), /market_prices_(provider_)?not_future/);
  await setQuote(S, '20', 0);
  assert.deepEqual(await snapshot(u), before);
});

test('insufficient cash and insufficient position change nothing', opts, async () => {
  const u = await provisionUser({ cash: '100' });
  await setQuote(S, '20');
  await placeOrder(u, { symbol: S, side: 'BUY', shares: '5', key: key() });  // spends exactly 100
  const before = await snapshot(u);
  assert.equal(toUnits(before.cash), 0n);
  await setQuote(S, '20.00000001');
  await expectRejected(placeOrder(u, { symbol: S, side: 'BUY', shares: '1', key: key() }), 'T0006');
  await expectRejected(placeOrder(u, { symbol: S, side: 'SELL', shares: '5.00000001', key: key() }), 'T0007');
  await expectRejected(placeOrder(u, { symbol: 'CRTTIE', side: 'SELL', shares: '1', key: key() }), 'T0007');
  assert.deepEqual(await snapshot(u), before);
  assert.deepEqual(await reconcile(u), []);
  await setQuote(S, '20');
});

test('weighted average entry price over several buys is exact to 8 decimals', opts, async () => {
  const u = await provisionUser({ cash: '100000' });
  await setQuote(S, '10'); await placeOrder(u, { symbol: S, side: 'BUY', shares: '10', key: key() });
  await setQuote(S, '20'); await placeOrder(u, { symbol: S, side: 'BUY', shares: '10', key: key() });
  await inContext(pools.app, u, async c => {
    const { rows } = await c.query('SELECT entry_price::text AS p, shares::text AS s FROM paper_positions WHERE symbol = $1', [S]);
    assert.equal(toUnits(rows[0].p), toUnits('15')); assert.equal(toUnits(rows[0].s), toUnits('20'));
  });
  assert.deepEqual(await reconcile(u), []);
  await setQuote(S, '20');
});

test('the opening balance is immutable and a new account must start at its opening balance', opts, async () => {
  const u = await provisionUser({ cash: '777' });
  // Even the table owner, acting with the user\'s context, is stopped by the trigger.
  await assert.rejects(inContext(pools.owner, u, c => c.query('UPDATE paper_accounts SET opening_cash = 1 WHERE user_id = $1', [u.userId])), /immutable/);
  const other = { userId: randomUUID(), tenant: `t-${randomUUID()}` };
  await assert.rejects(inContext(pools.prov, other, async c => {
    await c.query('INSERT INTO users (id, azee_user_id, tenant_id) VALUES ($1,$2,$3)', [other.userId, `azee-${randomUUID()}`, other.tenant]);
    await c.query('INSERT INTO paper_accounts (user_id, cash, opening_cash) VALUES ($1, 100, 5)', [other.userId]);
  }), e => e.code === 'T0010');
});

test('reconciliation detects corruption made outside the procedure', opts, async () => {
  const u = await provisionUser({ cash: '1000' });
  await setQuote(S, '10');
  await placeOrder(u, { symbol: S, side: 'BUY', shares: '10', key: key() });
  assert.deepEqual(await reconcile(u), []);
  // Corrupt cash as the owner (the only role that could). The reconciler must flag it, by exactly that amount.
  await inContext(pools.owner, u, c => c.query('UPDATE paper_accounts SET cash = cash + 1 WHERE user_id = $1', [u.userId]));
  const rows = await reconcile(u);
  const v = rows.find(r => r.check_name === 'cash');
  assert.ok(v, `expected a cash violation, got ${JSON.stringify(rows)}`);
  assert.equal(toUnits(v.actual) - toUnits(v.expected), toUnits('1'));
});

test('privilege boundary: the application role cannot write money tables or the ledger directly', opts, async () => {
  const u = await provisionUser({ cash: '1000' });
  await setQuote(S, '10');
  const placed = await placeOrder(u, { symbol: S, side: 'BUY', shares: '1', key: key() });
  await inContext(pools.app, u, async c => {
    for (const sql of [
      'UPDATE paper_accounts SET cash = cash + 1000000',
      'UPDATE paper_positions SET shares = shares + 1000',
      'DELETE FROM paper_positions',
      'DELETE FROM paper_orders',
      'UPDATE paper_orders SET price = 0.0001',
      'DELETE FROM paper_ledger',
      'UPDATE paper_ledger SET amount = 1',
      'TRUNCATE paper_ledger',
      "INSERT INTO paper_ledger (account_id, entry_type, account_code, amount) SELECT id, 'debit', 'cash', 1 FROM paper_accounts",
      'INSERT INTO paper_accounts (user_id, cash) VALUES (gen_random_uuid(), 1)',
      'UPDATE market_prices SET price = 0.01',
      "UPDATE users SET tier = 'premium'",
    ]) {
      await c.query('SAVEPOINT s');
      await assert.rejects(c.query(sql), /permission denied|append-only|row-level security/i, `must be refused: ${sql}`);
      await c.query('ROLLBACK TO SAVEPOINT s');
    }
  });
  assert.equal((await snapshot(u)).orders, 1);
  assert.equal(placed.order.status, 'filled');
  assert.deepEqual(await reconcile(u), []);
});

test('tenant isolation: a forged or missing identity cannot see or post to another account', opts, async () => {
  const a = await provisionUser({ cash: '1000' });
  const b = await provisionUser({ cash: '2000' });
  await setQuote(S, '10');
  // B's user id presented with A's tenant (a forged tenant claim): no account is visible and nothing posts.
  await expectRejected(placeOrder({ userId: b.userId, tenant: a.tenant }, { symbol: S, side: 'BUY', shares: '1', key: key() }), 'T0002');
  // No identity at all.
  const c = await pools.app.connect();
  try {
    await c.query('BEGIN');
    await expectRejected(c.query("SELECT aztrade_place_paper_order('CRTP1','BUY',1,'abcdefgh1','" + '0'.repeat(64) + "')"), 'T0001');
  } finally { await c.query('ROLLBACK').catch(() => {}); c.release(); }
  // A cannot read B's rows in any table.
  await inContext(pools.app, a, async cl => {
    const probes = [
      ['users', 'id = $1', [b.userId]], ['portfolios', 'user_id = $1', [b.userId]], ['paper_accounts', 'user_id = $1', [b.userId]],
      ['paper_positions', 'account_id = $1', [b.accountId]], ['paper_orders', 'account_id = $1', [b.accountId]], ['paper_ledger', 'account_id = $1', [b.accountId]],
    ];
    for (const [table, where, params] of probes) {
      const { rows } = await cl.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, params);
      assert.equal(rows[0].n, 0, `${table}: tenant A saw tenant B's rows`);
    }
  });
  assert.equal(toUnits((await snapshot(b)).cash), toUnits('2000'));
});
