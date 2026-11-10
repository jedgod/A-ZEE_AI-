import test from 'node:test';
import assert from 'node:assert/strict';
import { validateQuote, ingestQuotes, LIMITS } from '../lib/marketdata/ingest.js';
import { NotConfiguredProvider, FixtureProvider, ProviderUnavailableError } from '../lib/marketdata/provider.js';

// No database needed: validation is pure, and ingestion is exercised with a recording fake pool.
const NOW = Date.parse('2026-11-09T15:00:00Z');
const q = (over = {}) => ({ symbol: 'ACME', price: '100.5', providerTimestamp: '2026-11-09T14:59:30Z', ...over });
const check = (quote, extra = {}) => validateQuote(quote, { now: NOW, ...extra });

test('a well-formed fresh quote is accepted', () => assert.deepEqual(check(q()), { ok: true }));

test('prices must be positive decimal TEXT with at most 8 fractional digits (never a float)', () => {
  for (const price of [100.5, null, undefined, '', '-1', '0', '0.0', '1e3', '1,5', ' 1', '1.123456789', 'NaN', 'Infinity', '12345678901', '01.5'])
    assert.equal(check(q({ price })).ok, false, `must reject ${JSON.stringify(price)}`);
  for (const price of ['0.00000001', '1', '99.99999999', '1234567890.12345678']) assert.equal(check(q({ price })).ok, true, `must accept ${price}`);
});

test('symbols are validated', () => {
  for (const symbol of ['', 'lower', 'A B', "X';--", 'A'.repeat(33), null]) assert.equal(check(q({ symbol })).reason, 'invalid_symbol');
});

test('timestamps: invalid, future and stale are each refused with their own reason', () => {
  assert.equal(check(q({ providerTimestamp: 'yesterday' })).reason, 'invalid_timestamp');
  assert.equal(check(q({ providerTimestamp: undefined })).reason, 'invalid_timestamp');
  assert.equal(check(q({ providerTimestamp: '2026-11-09T15:02:00Z' })).reason, 'future_timestamp');
  assert.equal(check(q({ providerTimestamp: '2026-11-09T15:00:30Z' })).ok, true, 'within the 60 s clock tolerance');
  assert.equal(check(q({ providerTimestamp: '2026-11-09T14:44:00Z' })).reason, 'stale');
  assert.equal(check(q({ providerTimestamp: '2026-11-09T14:45:30Z' })).ok, true);
});

test('a price never moves backwards in provider time', () => {
  const previous = { price: '100', providerTimestamp: Date.parse('2026-11-09T14:59:45Z') };
  assert.equal(check(q({ providerTimestamp: '2026-11-09T14:59:30Z' }), { previous }).reason, 'not_newer');
  assert.equal(check(q({ providerTimestamp: '2026-11-09T14:59:45Z' }), { previous }).reason, 'not_newer', 'equal is not newer');
  assert.equal(check(q({ providerTimestamp: '2026-11-09T14:59:50Z', price: '101' }), { previous }).ok, true);
});

test('extreme moves are rejected with exact arithmetic', () => {
  const previous = { price: '100', providerTimestamp: Date.parse('2026-11-09T14:00:00Z') };
  assert.equal(check(q({ price: '150' }), { previous }).ok, true, 'exactly +50% is allowed');
  assert.equal(check(q({ price: '150.00000001' }), { previous }).reason, 'outlier');
  assert.equal(check(q({ price: '50' }), { previous }).ok, true, 'exactly -50% is allowed');
  assert.equal(check(q({ price: '49.99999999' }), { previous }).reason, 'outlier');
  assert.equal(check(q({ price: '1000' }), { previous }).reason, 'outlier');
  assert.equal(check(q({ price: '1000' }), { previous: null }).ok, true, 'no previous price, nothing to compare with');
});

/** A fake pool that records writes. */
function fakePool(stored = {}) {
  const writes = [];
  return {
    writes,
    async query(sql, params) {
      if (/^SELECT price/.test(sql)) { const r = stored[params[0]]; return { rows: r ? [r] : [] }; }
      if (/^INSERT INTO market_prices/.test(sql)) { writes.push(params); return { rowCount: 1 }; }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
}

test('with no provider configured, ingestion fails closed: an outage, nothing written', async () => {
  const pool = fakePool();
  const r = await ingestQuotes({ provider: new NotConfiguredProvider(), symbols: ['ACME', 'BETA'], pool, now: NOW });
  assert.equal(r.outage, true);
  assert.deepEqual(r.rejected.map(x => x.reason), ['provider_unavailable', 'provider_unavailable']);
  assert.equal(pool.writes.length, 0);
});

test('any provider failure is an outage and writes nothing', async () => {
  const provider = { sourceId: 'x', fetchQuotes: async () => { throw new ProviderUnavailableError('503 from vendor'); } };
  const boom = { sourceId: 'x', fetchQuotes: async () => { throw new TypeError('socket hang up'); } };
  for (const p of [provider, boom]) {
    const pool = fakePool();
    const r = await ingestQuotes({ provider: p, symbols: ['ACME'], pool, now: NOW });
    assert.equal(r.outage, true); assert.equal(pool.writes.length, 0);
  }
});

test('valid quotes are written with the provider\'s source and time; bad ones are reported and do not block the rest', async () => {
  const pool = fakePool({ BETA: { price: '10', provider_timestamp: new Date('2026-11-09T14:00:00Z') } });
  const provider = new FixtureProvider('vendor-x', [
    q({ symbol: 'ACME' }),
    q({ symbol: 'BETA', price: '90' }),                        // +800%: outlier
    q({ symbol: 'GAMMA', price: 'abc' }),                      // malformed
  ]);
  const r = await ingestQuotes({ provider, symbols: ['ACME', 'BETA', 'GAMMA', 'DELTA'], pool, now: NOW });
  assert.deepEqual(r.written, ['ACME']);
  assert.deepEqual(r.rejected.map(x => `${x.symbol}:${x.reason}`).sort(), ['BETA:outlier', 'DELTA:missing_from_provider', 'GAMMA:invalid_price']);
  assert.equal(pool.writes.length, 1);
  assert.deepEqual(pool.writes[0], ['ACME', '100.5', '2026-11-09T14:59:30Z', 'vendor-x'], 'price text, provider time and source id are stored as given');
});

test('limits are frozen', () => assert.throws(() => { 'use strict'; LIMITS.maxAgeMs = 1; }));
