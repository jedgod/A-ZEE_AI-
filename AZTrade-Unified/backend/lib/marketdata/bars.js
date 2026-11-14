import { ProviderUnavailableError } from './provider.js';

// Historical daily bars for research backtests. Same rule as quotes: no vendor is configured, so by default this
// fails closed. A real adapter implements fetchBars(symbol, { start, end }) -> { sourceId, bars } where each bar is
// { timestamp: ISO-8601, open, high, low, close, volume } (numbers), and the vendor's licence must allow historical
// analysis. Registering one is a deliberate deployment step (setBarsProvider), never something a request can do.

export class NoBarsProvider {
  async fetchBars() { throw new ProviderUnavailableError('No licensed historical data provider is configured'); }
}

/** Replays fixed bars. For tests only. */
export class FixtureBarsProvider {
  constructor(sourceId, bars) { this.sourceId = sourceId; this.bars = bars; }
  async fetchBars(symbol, { start, end }) {
    return { sourceId: this.sourceId, bars: this.bars.filter(b => { const t = Date.parse(b.timestamp); return t >= start && t <= end; }) };
  }
}

let provider = new NoBarsProvider();
export const getBarsProvider = () => provider;
export function setBarsProvider(next) { provider = next; }
