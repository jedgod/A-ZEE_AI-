import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { BacktestInputError, runBacktest } from '../lib/backtest.js';
import { FixtureBarsProvider, NoBarsProvider, setBarsProvider } from '../lib/marketdata/bars.js';
import strategies from '../routes/strategies.js';
import { QuotaUnavailableError, setQuotaClient } from '../lib/quota.js';

// A fake A-Zee quota service that records what the route asks of it.
function fakeQuota({ limit = 10, down = false } = {}) {
  const calls = { reserve: [], refund: [] }; let used = 0;
  setQuotaClient({
    async reserve(user, feature, requestId) { calls.reserve.push({ user, feature, requestId }); if (down) throw new QuotaUnavailableError('down'); if (used >= limit) return { allowed: false, used, limit, remaining: 0, replay: false }; used++; return { allowed: true, used, limit, remaining: limit - used, replay: false }; },
    async refund(user, feature, requestId) { calls.refund.push({ user, feature, requestId }); used--; return true; },
  });
  return calls;
}

const day = i => new Date(Date.UTC(2025, 0, 1 + i)).toISOString();
const rising = n => Array.from({ length: n }, (_, i) => ({ timestamp: day(i), open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, volume: 1000 }));
const base = { strategy: 'momentum', lookback: 5, initialCash: 10_000, feeBps: 10, slippageBps: 5 };

test('engine: bounded equity curve on a steady uptrend, and it makes money long-only', () => {
  const r = runBacktest({ ...base, bars: rising(40) });
  assert.equal(r.equityCurve.length, 35);
  assert.ok(Number.isFinite(r.finalEquity) && r.maxDrawdownPct >= 0);
  assert.ok(r.finalEquity > r.initialCash);
  assert.equal(r.trades, 1);
});

test('engine: no look-ahead. The trade fills at the open of the bar AFTER the signal, never at the signal close', () => {
  const bars = rising(12);
  // Make bar 5 open absurdly high: if the engine filled at a later or earlier price the equity would not reflect it.
  bars[5] = { ...bars[5], open: 500, high: 501, low: 499, close: 500 };
  const r = runBacktest({ ...base, bars });
  // The first entry is at bar 5 (signal from closes before it). It must pay ~500*(1+slip), so the first equity is ~cash.
  const first = r.equityCurve[0];
  assert.ok(Math.abs(first.equity - 10_000) < 100, `unexpected first equity ${first.equity}`);
});

test('engine: costs reduce the result', () => {
  const free = runBacktest({ ...base, feeBps: 0, slippageBps: 0, bars: rising(60) });
  const costly = runBacktest({ ...base, feeBps: 50, slippageBps: 50, bars: rising(60) });
  assert.ok(costly.finalEquity < free.finalEquity);
});

test('engine: rejects bad input and malformed bars', () => {
  const bad = patch => () => runBacktest({ ...base, bars: rising(40), ...patch });
  assert.throws(bad({ feeBps: -1 }), BacktestInputError);
  assert.throws(bad({ slippageBps: 501 }), BacktestInputError);
  assert.throws(bad({ lookback: 1 }), BacktestInputError);
  assert.throws(bad({ lookback: 1.5 }), BacktestInputError);
  assert.throws(bad({ initialCash: 5 }), BacktestInputError);
  assert.throws(bad({ strategy: 'martingale' }), BacktestInputError);
  assert.throws(bad({ bars: rising(6) }), /NOT_ENOUGH_BARS/);
  const unordered = rising(40); [unordered[3], unordered[4]] = [unordered[4], unordered[3]];
  assert.throws(bad({ bars: unordered }), /BARS_NOT_ORDERED/);
  const broken = rising(40); broken[10] = { ...broken[10], high: 1 };
  assert.throws(bad({ bars: broken }), /INVALID_BARS/);
});

// ---- the route ----
async function serve(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/strategies', strategies);
  const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  return { url: `http://127.0.0.1:${server.address().port}/api/strategies`, close: () => server.close() };
}
const body = (over = {}) => JSON.stringify({ symbol: 'TEST', start: day(0), end: day(60), lookback: 5, ...over });
const post = (url, id, payload) => fetch(`${url}/${id}/backtest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload });

test('route: lists strategies without internals', async () => {
  const s = await serve({ tier: 'plus', azee_user_id: 'u1' });
  const list = await (await fetch(s.url)).json();
  s.close();
  assert.deepEqual(list.map(x => x.id), ['momentum', 'mean-reversion']);
  assert.ok(list.every(x => !('engine' in x)));
});

test('route: free tier is refused; plus without a licensed provider gets 503 and no numbers', async () => {
  setBarsProvider(new NoBarsProvider());
  const free = await serve({ tier: 'free' });
  assert.equal((await post(free.url, 'momentum', body())).status, 403);
  free.close();
  const plus = await serve({ tier: 'plus', azee_user_id: 'u1' });
  const r = await post(plus.url, 'momentum', body());
  const json = await r.json();
  plus.close();
  assert.equal(r.status, 503);
  assert.equal(json.error, 'MARKET_DATA_UNAVAILABLE');
  assert.equal(json.result, undefined);
});

test('route: with a provider it runs a real backtest; limits and validation are enforced', async () => {
  fakeQuota();
  const s = await serve({ tier: 'plus', azee_user_id: 'u1' });
  setBarsProvider(new FixtureBarsProvider('test-source', rising(60)));
  const ok = await post(s.url, 'mean-reversion', body());
  const json = await ok.json();
  assert.equal(ok.status, 200);
  assert.equal(json.mode, 'historical_simulation');
  assert.equal(json.sourceId, 'test-source');
  assert.ok(json.result.equityCurve.length > 0);

  assert.equal((await post(s.url, 'nope', body())).status, 404);
  assert.equal((await post(s.url, 'momentum', body({ symbol: 'bad symbol!' }))).status, 400);
  assert.equal((await post(s.url, 'momentum', body({ start: day(10), end: day(5) }))).status, 400);
  assert.equal((await post(s.url, 'momentum', body({ feeBps: 9999 }))).status, 400);
  assert.equal((await post(s.url, 'momentum', body({ lookback: 70 }))).status, 422); // more lookback than data
  const huge = Array.from({ length: 2500 }, (_, i) => ({ timestamp: day(i), open: 100, high: 101, low: 99, close: 100, volume: 1 }));
  setBarsProvider({ fetchBars: async () => ({ sourceId: 'big', bars: huge }) }); // a vendor returning more bars than the plan allows
  const tooMany = await post(s.url, 'momentum', body());
  assert.equal(tooMany.status, 403);
  assert.equal((await tooMany.json()).error, 'PLAN_BAR_LIMIT_EXCEEDED');
  s.close();
  setBarsProvider(new NoBarsProvider());
});

test('route: reserves one daily slot per run and reports it; an exhausted quota answers 429 and runs nothing', async () => {
  const calls = fakeQuota({ limit: 2 });
  setBarsProvider(new FixtureBarsProvider('q', rising(60)));
  const s = await serve({ tier: 'plus', azee_user_id: 'u1' });
  const first = await (await post(s.url, 'momentum', body())).json();
  assert.equal(first.quota.used, 1); assert.equal(first.quota.remaining, 1);
  assert.deepEqual(calls.reserve[0], { user: 'u1', feature: 'backtest', requestId: first.requestId });
  assert.equal((await post(s.url, 'momentum', body())).status, 200);
  const third = await post(s.url, 'momentum', body());
  assert.equal(third.status, 429);
  assert.equal((await third.json()).error, 'DAILY_LIMIT_REACHED');
  s.close(); setBarsProvider(new NoBarsProvider());
});

test('route: a client request id is passed to A-Zee unchanged so a retry is not charged twice', async () => {
  const calls = fakeQuota();
  setBarsProvider(new FixtureBarsProvider('q', rising(60)));
  const s = await serve({ tier: 'plus', azee_user_id: 'u1' });
  const id = '3f2b8c1e-1a2b-4c3d-8e4f-5a6b7c8d9e0f';
  await post(s.url, 'momentum', body({ requestId: id }));
  assert.equal(calls.reserve[0].requestId, id);
  s.close(); setBarsProvider(new NoBarsProvider());
});

test('route: a run that fails after reserving gives the slot back', async () => {
  const calls = fakeQuota();
  setBarsProvider(new FixtureBarsProvider('q', rising(60)));
  const s = await serve({ tier: 'plus', azee_user_id: 'u1' });
  const r = await post(s.url, 'momentum', body({ lookback: 70 }));     // more lookback than bars: fails inside the engine
  assert.equal(r.status, 422);
  assert.equal(calls.reserve.length, 1);
  assert.equal(calls.refund.length, 1);
  assert.equal(calls.refund[0].requestId, calls.reserve[0].requestId);
  s.close(); setBarsProvider(new NoBarsProvider());
});

test('route: no data means no reservation; quota service down means the work is refused', async () => {
  const calls = fakeQuota();
  const s = await serve({ tier: 'plus', azee_user_id: 'u1' });
  setBarsProvider(new NoBarsProvider());
  assert.equal((await post(s.url, 'momentum', body())).status, 503);
  assert.equal(calls.reserve.length, 0);                                  // an outage of the data costs the user nothing
  const down = fakeQuota({ down: true });
  setBarsProvider(new FixtureBarsProvider('q', rising(60)));
  const r = await post(s.url, 'momentum', body());
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error, 'QUOTA_UNAVAILABLE');
  assert.equal(down.refund.length, 0);
  s.close(); setBarsProvider(new NoBarsProvider());
});
