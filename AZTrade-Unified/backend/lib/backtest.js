// Deterministic, long-only, daily-bar research backtester. Research only: it uses floating point and is NOT the paper
// ledger (which stays exact NUMERIC in PostgreSQL). It is not a certified institutional engine: corporate actions,
// exchange calendars, funding costs, portfolio-level risk and survivorship-bias controls are not modelled.
//
// Look-ahead safeguard: the signal for bar i uses ONLY bars before i, and the trade executes at bar i's open, never at
// the close that produced the signal.

export const STRATEGIES = Object.freeze(['momentum', 'mean_reversion']);
export const LIMITS = Object.freeze({ minLookback: 2, maxLookback: 250, maxCostBps: 500, minCash: 100, maxCash: 10_000_000 });

export class BacktestInputError extends Error {
  constructor(code) { super(code); this.name = 'BacktestInputError'; this.code = code; }
}

const finite = n => typeof n === 'number' && Number.isFinite(n);

/** Bars must be strictly time-ordered, positive and internally consistent (low <= open/close <= high). */
export function validateBars(bars) {
  if (!Array.isArray(bars)) throw new BacktestInputError('INVALID_BARS');
  let previous = -Infinity;
  for (const b of bars) {
    const t = Date.parse(b?.timestamp);
    if (!Number.isFinite(t) || t <= previous) throw new BacktestInputError('BARS_NOT_ORDERED');
    previous = t;
    if (![b.open, b.high, b.low, b.close].every(v => finite(v) && v > 0) || !finite(b.volume) || b.volume < 0) throw new BacktestInputError('INVALID_BARS');
    if (b.high < Math.max(b.open, b.close, b.low) || b.low > Math.min(b.open, b.close, b.high)) throw new BacktestInputError('INVALID_BARS');
  }
}

export function runBacktest({ bars, strategy, lookback, initialCash, feeBps, slippageBps }) {
  if (!STRATEGIES.includes(strategy)) throw new BacktestInputError('UNKNOWN_STRATEGY');
  if (!Number.isInteger(lookback) || lookback < LIMITS.minLookback || lookback > LIMITS.maxLookback) throw new BacktestInputError('INVALID_LOOKBACK');
  if (!finite(initialCash) || initialCash < LIMITS.minCash || initialCash > LIMITS.maxCash) throw new BacktestInputError('INVALID_CASH');
  for (const bps of [feeBps, slippageBps]) if (!finite(bps) || bps < 0 || bps > LIMITS.maxCostBps) throw new BacktestInputError('INVALID_COSTS');
  validateBars(bars);
  if (bars.length < lookback + 3) throw new BacktestInputError('NOT_ENOUGH_BARS');

  const fee = feeBps / 10_000, slip = slippageBps / 10_000;
  let cash = initialCash, quantity = 0, trades = 0, peak = initialCash, maxDrawdown = 0;
  const equityCurve = [];

  for (let i = lookback; i < bars.length; i++) {
    let sum = 0;
    for (let k = i - lookback; k < i; k++) sum += bars[k].close;
    const average = sum / lookback;
    const previousClose = bars[i - 1].close;
    const wantOwn = strategy === 'momentum' ? previousClose > average : previousClose < average;
    const open = bars[i].open;

    if (wantOwn && quantity === 0) {
      const price = open * (1 + slip);
      const buy = Math.floor((cash / (price * (1 + fee))) * 1e8) / 1e8;
      if (buy > 0) { cash -= buy * price * (1 + fee); quantity = buy; trades++; }
    } else if (!wantOwn && quantity > 0) {
      cash += quantity * open * (1 - slip) * (1 - fee);
      quantity = 0; trades++;
    }

    const equity = cash + quantity * bars[i].close;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak > 0 ? ((peak - equity) / peak) * 100 : 0);
    equityCurve.push({ timestamp: bars[i].timestamp, equity });
  }

  const finalEquity = cash + quantity * bars[bars.length - 1].close;
  return { initialCash, finalEquity, totalReturnPct: (finalEquity / initialCash - 1) * 100, maxDrawdownPct: maxDrawdown, trades, equityCurve };
}
