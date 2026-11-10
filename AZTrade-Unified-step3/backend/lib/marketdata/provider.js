// A market-data provider supplies quotes WITH provenance. No vendor is configured: a licensed vendor is a legal and
// commercial decision, and until one is registered (market_data_sources, by the database owner) no price can drive a fill.
//
// Provider contract:
//   provider.sourceId                        string  - the id registered in market_data_sources (the database enforces it)
//   provider.fetchQuotes(symbols[]) -> Promise<Quote[]>
//   Quote = { symbol: 'AAPL', price: '228.45' (decimal STRING, never a float), providerTimestamp: ISO-8601 string }
//
// A real vendor adapter implements exactly this and nothing else. Throw ProviderUnavailableError for any outage.

export class ProviderUnavailableError extends Error {
  constructor(message = 'market data provider unavailable') { super(message); this.name = 'ProviderUnavailableError'; }
}

/** The default. Fails closed: with no licensed provider configured nothing is ingested and nothing can be executed. */
export class NotConfiguredProvider {
  sourceId = 'none';
  async fetchQuotes() { throw new ProviderUnavailableError('No licensed market data provider is configured'); }
}

/** Replays fixed quotes. For tests only; its source must be registered by a test fixture, never by production configuration. */
export class FixtureProvider {
  constructor(sourceId, quotes) { this.sourceId = sourceId; this.quotes = quotes; }
  async fetchQuotes(symbols) { return this.quotes.filter(q => symbols.includes(q.symbol)); }
}
