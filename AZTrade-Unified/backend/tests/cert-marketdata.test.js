import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { enabled, config, pools, closePools, provisionUser, placeOrder, reconcile, snapshot, setQuote, createInstrument,
  inContext, ensureTestSource, TEST_SOURCE, toUnits } from './helpers/cert.js';
import { ingestQuotes } from '../lib/marketdata/ingest.js';
import { NotConfiguredProvider, FixtureProvider } from '../lib/marketdata/provider.js';

// Market-data provenance and the licence gate, against the real database and the restricted roles.
const opts = { skip: !enabled };
const key = () => `m-${randomUUID()}`;
const md = enabled ? new pg.Pool({ connectionString: config.marketdataUrl, max: 4 }) : null;   // the ingestion role
const isoAgo = (s) => new Date(Date.now() - s * 1000).toISOString();

test.before(async () => { if (enabled) await ensureTestSource(); });
test.after(async () => { if (md) await md.end(); await closePools(); });

async function addSource(id, fields) {
  const f = { license_status: 'licensed', license_reference: 'TEST-REF', allows_execution: true, valid_until: null, ...fields };
  await pools.owner.query(`INSERT INTO market_data_sources (id, name, license_status, license_reference, allows_execution, valid_until)
    VALUES ($1, $1, $2, $3, $4, $5) ON CONFLICT (id) DO UPDATE SET license_status = $2, license_reference = $3, allows_execution = $4, valid_until = $5`,
    [id, f.license_status, f.license_reference, f.allows_execution, f.valid_until]);
}
async function priceFrom(symbol, price, sourceId) {
  await pools.owner.query(`INSERT INTO instruments (symbol, name, type) VALUES ($1, $1, 'stock') ON CONFLICT (symbol) DO UPDATE SET active = true`, [symbol]);
  await pools.owner.query(`INSERT INTO market_prices (symbol, price, updated_at, provider_timestamp, source_id) VALUES ($1, $2::numeric, now(), now(), $3)
    ON CONFLICT (symbol) DO UPDATE SET price = $2::numeric, updated_at = now(), provider_timestamp = now(), source_id = $3`, [symbol, price, sourceId]);
}
const refused = (p, code) => assert.rejects(p, e => { assert.equal(e.code, code, `expected ${code}, got ${e.code}: ${e.message}`); return true; });

test('seeded demo prices can never drive a fill: execution is refused with T0009', opts, async () => {
  const u = await provisionUser({ cash: '1000' });
  const before = await snapshot(u);
  await refused(placeOrder(u, { symbol: 'AAPL', side: 'BUY', shares: '1', key: key() }), 'T0009');   // a seeded instrument, source demo-seed
  assert.deepEqual(await snapshot(u), before);
  const { rows } = await pools.owner.query("SELECT source_id FROM market_prices WHERE symbol = 'AAPL'");
  assert.equal(rows[0].source_id, 'demo-seed');
});

test('an unregistered price defaults to the demo source and cannot execute', opts, async () => {
  await pools.owner.query(`INSERT INTO instruments (symbol, name, type) VALUES ('CRTMD0', 'x', 'stock') ON CONFLICT DO NOTHING`);
  await pools.owner.query(`INSERT INTO market_prices (symbol, price) VALUES ('CRTMD0', 5) ON CONFLICT (symbol) DO UPDATE SET price = 5, source_id = 'demo-seed', updated_at = now()`);
  const u = await provisionUser({ cash: '1000' });
  await refused(placeOrder(u, { symbol: 'CRTMD0', side: 'BUY', shares: '1', key: key() }), 'T0009');
});

test('a licensed source that allows execution fills, and the fill records the source and the provider observation time', opts, async () => {
  await addSource('vendor-ok', {});
  await priceFrom('CRTMD1', '50', 'vendor-ok');
  const u = await provisionUser({ cash: '1000' });
  const r = await placeOrder(u, { symbol: 'CRTMD1', side: 'BUY', shares: '2', key: key() });
  assert.equal(r.order.price_source_id, 'vendor-ok');
  assert.ok(Math.abs(Date.parse(r.order.price_observed_at) - Date.now()) < 60000, 'observation time is the provider time');
  assert.deepEqual(await reconcile(u), []);
});

test('expired, demo, test and execution-disallowed sources are refused', opts, async () => {
  const u = await provisionUser({ cash: '1000' });
  await addSource('vendor-expired', { valid_until: new Date(Date.now() - 1000).toISOString() });
  await addSource('vendor-noexec', { allows_execution: false });
  await addSource('vendor-test', { license_status: 'test', license_reference: null, allows_execution: false });
  await addSource('vendor-lapsed', { license_status: 'expired', license_reference: 'OLD', allows_execution: false });
  for (const [sym, src] of [['CRTMD2', 'vendor-expired'], ['CRTMD3', 'vendor-noexec'], ['CRTMD4', 'vendor-test'], ['CRTMD5', 'vendor-lapsed']]) {
    await priceFrom(sym, '10', src);
    await refused(placeOrder(u, { symbol: sym, side: 'BUY', shares: '1', key: key() }), 'T0009');
  }
  assert.equal((await snapshot(u)).orders, 0);
});

test('licence rules are enforced by the database itself', opts, async () => {
  await assert.rejects(addSource('bad-1', { license_status: 'licensed', license_reference: '  ' }), /licensed_needs_reference/);
  await assert.rejects(addSource('bad-2', { license_status: 'demo', allows_execution: true }), /execution_needs_licence/);
  await assert.rejects(addSource('Bad Id!', {}), /check/i);
  // A source that priced anything cannot be deleted.
  await assert.rejects(pools.owner.query("DELETE FROM market_data_sources WHERE id = 'demo-seed'"), e => e.code === 'T0012' || /referenced|foreign key/.test(e.message));
});

test('provider time cannot be re-stamped: a stale provider timestamp blocks a fill even if the row was just written', opts, async () => {
  await addSource('vendor-ok', {});
  await priceFrom('CRTMD6', '10', 'vendor-ok');
  await pools.owner.query("UPDATE market_prices SET provider_timestamp = now() - interval '20 minutes', updated_at = now() WHERE symbol = 'CRTMD6'");
  const u = await provisionUser({ cash: '1000' });
  await refused(placeOrder(u, { symbol: 'CRTMD6', side: 'BUY', shares: '1', key: key() }), 'T0005');
  await assert.rejects(pools.owner.query("UPDATE market_prices SET provider_timestamp = now() + interval '5 minutes' WHERE symbol = 'CRTMD6'"), /provider_not_future/);
});

test('ingestion role: writes prices with provenance through the real adapter code', opts, async () => {
  await addSource('vendor-ing', {});
  await pools.owner.query(`INSERT INTO instruments (symbol, name, type) VALUES ('CRTING', 'x', 'stock') ON CONFLICT DO NOTHING`);
  const provider = new FixtureProvider('vendor-ing', [{ symbol: 'CRTING', price: '12.3456789', providerTimestamp: isoAgo(5) }]);
  const r = await ingestQuotes({ provider, symbols: ['CRTING'], pool: md });
  assert.deepEqual(r.written, ['CRTING']);
  const { rows } = await pools.owner.query("SELECT price::text AS price, source_id, ingested_at IS NOT NULL AS stamped FROM market_prices WHERE symbol = 'CRTING'");
  assert.deepEqual([toUnits(rows[0].price), rows[0].source_id, rows[0].stamped], [toUnits('12.3456789'), 'vendor-ing', true]);
  // Older provider time and outlier jumps are refused, and the stored price is untouched.
  const older = await ingestQuotes({ provider: new FixtureProvider('vendor-ing', [{ symbol: 'CRTING', price: '12.5', providerTimestamp: isoAgo(60) }]), symbols: ['CRTING'], pool: md });
  assert.deepEqual(older.rejected, [{ symbol: 'CRTING', reason: 'not_newer' }]);
  const jump = await ingestQuotes({ provider: new FixtureProvider('vendor-ing', [{ symbol: 'CRTING', price: '99', providerTimestamp: isoAgo(1) }]), symbols: ['CRTING'], pool: md });
  assert.deepEqual(jump.rejected, [{ symbol: 'CRTING', reason: 'outlier' }]);
  const after = await pools.owner.query("SELECT price::text AS price FROM market_prices WHERE symbol = 'CRTING'");
  assert.equal(toUnits(after.rows[0].price), toUnits('12.3456789'));
});

test('ingestion role cannot name an unregistered source or an unknown symbol', opts, async () => {
  const unreg = await ingestQuotes({ provider: new FixtureProvider('not-registered', [{ symbol: 'CRTING', price: '12.4', providerTimestamp: isoAgo(1) }]), symbols: ['CRTING'], pool: md });
  assert.deepEqual(unreg.rejected, [{ symbol: 'CRTING', reason: 'unknown_symbol_or_source' }]);
  const unknown = await ingestQuotes({ provider: new FixtureProvider('vendor-ing', [{ symbol: 'NOPE9', price: '1', providerTimestamp: isoAgo(1) }]), symbols: ['NOPE9'], pool: md });
  assert.deepEqual(unknown.rejected, [{ symbol: 'NOPE9', reason: 'unknown_symbol_or_source' }]);
});

test('ingestion role privileges: no source registration, no licence change, no money tables', opts, async () => {
  for (const sql of [
    "INSERT INTO market_data_sources (id, name, license_status, license_reference, allows_execution) VALUES ('hijack', 'x', 'licensed', 'FAKE', true)",
    "UPDATE market_data_sources SET allows_execution = true, license_status = 'licensed', license_reference = 'FAKE' WHERE id = 'demo-seed'",
    'DELETE FROM market_data_sources',
    'UPDATE paper_accounts SET cash = 1e9', 'SELECT * FROM paper_ledger', 'INSERT INTO paper_ledger (account_id, entry_type, account_code, amount) SELECT id, \'debit\', \'cash\', 1 FROM paper_accounts',
    'SELECT * FROM users', 'DELETE FROM market_prices',
  ]) await assert.rejects(md.query(sql), /permission denied/i, `must be refused: ${sql}`);
});

test('provider outage: nothing is written and trading stops once prices age out', opts, async () => {
  await addSource('vendor-ok', {});
  await priceFrom('CRTMD7', '10', 'vendor-ok');
  const out = await ingestQuotes({ provider: new NotConfiguredProvider(), symbols: ['CRTMD7'], pool: md });
  assert.equal(out.outage, true);
  const u = await provisionUser({ cash: '1000' });
  assert.equal((await placeOrder(u, { symbol: 'CRTMD7', side: 'BUY', shares: '1', key: key() })).replay, false, 'a fresh licensed price still trades');
  await pools.owner.query("UPDATE market_prices SET provider_timestamp = now() - interval '16 minutes', updated_at = now() - interval '16 minutes' WHERE symbol = 'CRTMD7'");
  await refused(placeOrder(u, { symbol: 'CRTMD7', side: 'BUY', shares: '1', key: key() }), 'T0005');
});

test('the application role sees provenance but cannot change a source', opts, async () => {
  const u = await provisionUser({ cash: '10' });
  await inContext(pools.app, u, async c => {
    const { rows } = await c.query("SELECT id, license_status FROM market_data_sources WHERE id = 'demo-seed'");
    assert.equal(rows[0].license_status, 'demo');
    await c.query('SAVEPOINT s');
    await assert.rejects(c.query("UPDATE market_data_sources SET allows_execution = true"), /permission denied/i);
    await c.query('ROLLBACK TO SAVEPOINT s');
  });
  assert.equal(TEST_SOURCE, 'cert-fixture');
});
