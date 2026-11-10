// Minimal smoke checks (run with: node --test tests/smoke.test.js)
// These do not require a live database.

import { test } from 'node:test';
import assert from 'node:assert/strict';

function isValidOrder(body) {
  if (!body || typeof body !== 'object') return false;
  const sym = typeof body.symbol === 'string' ? body.symbol.trim().toUpperCase() : '';
  const qty = Number(body.shares);
  const key = body.idempotencyKey;
  return Boolean(
    sym &&
    ['BUY', 'SELL'].includes(body.side) &&
    Number.isFinite(qty) && qty > 0 && qty <= 1_000_000 &&
    typeof key === 'string' && key.length > 0 && key.length <= 128
  );
}

test('order validation rejects missing fields', () => {
  assert.equal(isValidOrder({ side: 'BUY', shares: 1 }), false);
  assert.equal(isValidOrder({ symbol: 'AAPL', side: 'BUY', shares: 1 }), false); // missing key
});

test('order validation accepts well-formed input', () => {
  const body = { symbol: 'aapl', side: 'BUY', shares: 2.5, idempotencyKey: 'abc-123' };
  assert.equal(isValidOrder(body), true);
});

test('idempotency key length guard', () => {
  const key = 'x'.repeat(200);
  assert.equal(isValidOrder({ symbol: 'AAPL', side: 'BUY', shares: 1, idempotencyKey: key }), false);
});
