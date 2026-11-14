import { Router } from 'express';
import { requireTier } from '../lib/auth.js';
import { BacktestInputError, LIMITS, runBacktest } from '../lib/backtest.js';
import { getBarsProvider } from '../lib/marketdata/bars.js';
import { ProviderUnavailableError } from '../lib/marketdata/provider.js';
import { getQuota, QuotaUnavailableError } from '../lib/quota.js';
import { randomUUID } from 'node:crypto';

const router = Router();

// Per-plan research limits. Kept in step with A-Zee's /api/aztrade/entitlements (lib/aztrade/entitlements.ts), which
// only DISPLAYS them; this is where bars are enforced. The DAILY run quota is counted by A-Zee (lib/quota.js).
export const BACKTEST_PLAN_LIMITS = Object.freeze({
  free: { maxBars: 0, runsPerDay: 0 },
  plus: { maxBars: 2000, runsPerDay: 10 },
  premium: { maxBars: 10000, runsPerDay: 50 },
});

const STRATEGY_LIST = [
  { id: 'momentum', name: 'Momentum', engine: 'momentum', description: 'Hold while the previous close is above its N-day average; exit when it falls below.', tierRequired: 'plus' },
  { id: 'mean-reversion', name: 'Mean Reversion', engine: 'mean_reversion', description: 'Hold while the previous close is below its N-day average; exit when it recovers above.', tierRequired: 'plus' },
];

// GET /api/strategies
router.get('/', (req, res) => {
  res.json(STRATEGY_LIST.map(({ engine, ...s }) => s));
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SYMBOL = /^[A-Z0-9._-]{1,30}$/;
const ISO = v => typeof v === 'string' && Number.isFinite(Date.parse(v));

// POST /api/strategies/:id/backtest  (Plus or higher). Runs on real historical bars from the licensed provider.
// With no licensed provider configured it answers 503 and runs nothing: no illustrative numbers are ever returned.
router.post('/:id/backtest', requireTier('plus'), async (req, res) => {
  const strategy = STRATEGY_LIST.find(s => s.id === req.params.id);
  if (!strategy) return res.status(404).json({ error: 'Strategy not found' });
  const b = req.body ?? {};
  const limits = BACKTEST_PLAN_LIMITS[req.user.tier];
  if (!limits || limits.maxBars === 0) return res.status(403).json({ error: 'Subscription required', required: 'plus', current: req.user.tier });
  let reserved = null;
  try {
    if (typeof b.symbol !== 'string' || !SYMBOL.test(b.symbol) || !ISO(b.start) || !ISO(b.end)) throw new BacktestInputError('INVALID_REQUEST');
    const start = new Date(b.start), end = new Date(b.end);
    if (end <= start || end > new Date() || end - start > 5 * 366 * 86_400_000) throw new BacktestInputError('INVALID_DATE_RANGE');
    const input = {
      strategy: strategy.engine, lookback: b.lookback ?? 20, initialCash: b.initialCash ?? 10_000,
      feeBps: b.feeBps ?? 10, slippageBps: b.slippageBps ?? 5,
    };

    const { sourceId, bars } = await getBarsProvider().fetchBars(b.symbol, { start, end });
    if (bars.length > limits.maxBars) return res.status(403).json({ error: 'PLAN_BAR_LIMIT_EXCEEDED', maxBars: limits.maxBars });

    // Reserve one daily slot with A-Zee only once there is data to run on (an outage costs the user nothing). The
    // client may send its own requestId (a UUID) so that a retry of the same request is not charged twice.
    const requestId = typeof b.requestId === 'string' && UUID.test(b.requestId) ? b.requestId : randomUUID();
    const slot = await getQuota().reserve(req.user.azee_user_id, 'backtest', requestId);
    if (!slot.allowed) return res.status(429).json({ error: 'DAILY_LIMIT_REACHED', limit: slot.limit, used: slot.used });
    reserved = { requestId };
    const result = runBacktest({ ...input, bars });
    return res.json({
      mode: 'historical_simulation', requestId: reserved.requestId, quota: { used: slot.used, limit: slot.limit, remaining: slot.remaining }, strategyId: strategy.id, symbol: b.symbol, sourceId, barCount: bars.length, result,
      disclaimer: 'Historical simulated performance is not a prediction of future returns. Daily bars, long only, next-bar open execution; corporate actions and exchange calendars are not modelled.',
    });
  } catch (error) {
    // A run that failed after its slot was reserved gives the slot back.
    if (reserved) await getQuota().refund(req.user.azee_user_id, 'backtest', reserved.requestId).catch(() => undefined);
    if (error instanceof QuotaUnavailableError) return res.status(503).json({ error: 'QUOTA_UNAVAILABLE' });
    if (error instanceof ProviderUnavailableError) return res.status(503).json({ error: 'MARKET_DATA_UNAVAILABLE' });
    if (error instanceof BacktestInputError) return res.status(error.code === 'NOT_ENOUGH_BARS' ? 422 : 400).json({ error: error.code, limits: LIMITS });
    console.error('AZTrade backtest failed:', error.message);
    return res.status(503).json({ error: 'BACKTEST_UNAVAILABLE' });
  }
});

export default router;
