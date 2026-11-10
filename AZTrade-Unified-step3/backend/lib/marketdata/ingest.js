// Validated, provenance-carrying market-data ingestion. Writes only through the restricted market-data role.
// Nothing here decides what may be traded: the posting procedure checks the source's licence at fill time.
export const LIMITS = Object.freeze({
  maxAgeMs: 15 * 60 * 1000,     // a quote older than this is not accepted (the posting procedure re-checks at fill time)
  maxFutureMs: 60 * 1000,       // provider clocks may run slightly ahead, not more
  maxMoveFraction: 0.5,         // a move of more than 50% against the stored price is rejected, not stored
});

const SYMBOL = /^[A-Z0-9._/-]{1,32}$/;
const PRICE = /^(?:0|[1-9]\d{0,9})(?:\.\d{1,8})?$/;   // positive decimal text, at most 10 integer and 8 fractional digits
const UNITS = 10n ** 8n;
const toUnits = (text) => { const [w, f = ''] = String(text).split('.'); return BigInt(w) * UNITS + BigInt(f.padEnd(8, '0')); };

/**
 * Pure validation of one quote against what is already stored (all price arithmetic is exact integer arithmetic).
 * Returns { ok: true } or { ok: false, reason } with a stable machine-readable reason.
 */
export function validateQuote(q, { now = Date.now(), previous = null, limits = LIMITS } = {}) {
  if (!q || typeof q.symbol !== 'string' || !SYMBOL.test(q.symbol)) return { ok: false, reason: 'invalid_symbol' };
  if (typeof q.price !== 'string' || !PRICE.test(q.price)) return { ok: false, reason: 'invalid_price' };
  const price = toUnits(q.price);
  if (price <= 0n) return { ok: false, reason: 'non_positive_price' };
  const at = typeof q.providerTimestamp === 'string' ? Date.parse(q.providerTimestamp) : NaN;
  if (!Number.isFinite(at)) return { ok: false, reason: 'invalid_timestamp' };
  if (at > now + limits.maxFutureMs) return { ok: false, reason: 'future_timestamp' };
  if (now - at > limits.maxAgeMs) return { ok: false, reason: 'stale' };
  if (previous) {
    if (previous.providerTimestamp != null && at <= previous.providerTimestamp) return { ok: false, reason: 'not_newer' };
    const before = toUnits(previous.price);
    const move = price > before ? price - before : before - price;
    if (before > 0n && move * 1000n > before * BigInt(Math.round(limits.maxMoveFraction * 1000))) return { ok: false, reason: 'outlier' };
  }
  return { ok: true };
}

/**
 * Fetches quotes from the provider and stores the valid ones with provenance (source, provider time, ingestion time).
 * - Provider outage: nothing is written and `outage: true` is returned; existing prices simply age out and trading stops.
 * - Every rejected quote is reported with its reason; one bad quote never blocks the others.
 * - A stored price never moves backwards in provider time (enforced again in SQL, so a race cannot regress it).
 */
export async function ingestQuotes({ provider, symbols, pool, now = Date.now(), limits = LIMITS }) {
  let quotes;
  try { quotes = await provider.fetchQuotes(symbols); }
  catch {
    // Any provider failure is an outage: fail closed, write nothing, let existing prices age out.
    return { written: 0, rejected: symbols.map(symbol => ({ symbol, reason: 'provider_unavailable' })), outage: true };
  }
  const result = { written: [], rejected: [], outage: false };
  const answered = new Set();
  for (const q of quotes) {
    answered.add(q?.symbol);
    const { rows } = await pool.query('SELECT price::text AS price, provider_timestamp FROM market_prices WHERE symbol = $1', [q?.symbol ?? '']);
    const previous = rows[0] ? { price: rows[0].price, providerTimestamp: rows[0].provider_timestamp ? new Date(rows[0].provider_timestamp).getTime() : null } : null;
    const verdict = validateQuote(q, { now, previous, limits });
    if (!verdict.ok) { result.rejected.push({ symbol: q?.symbol ?? null, reason: verdict.reason }); continue; }
    try {
      const w = await pool.query(
        `INSERT INTO market_prices (symbol, price, provider_timestamp, source_id, ingested_at, updated_at)
         VALUES ($1, $2::numeric, $3::timestamptz, $4, now(), now())
         ON CONFLICT (symbol) DO UPDATE SET price = EXCLUDED.price, provider_timestamp = EXCLUDED.provider_timestamp,
           source_id = EXCLUDED.source_id, ingested_at = now(), updated_at = now()
         WHERE market_prices.provider_timestamp IS NULL OR EXCLUDED.provider_timestamp > market_prices.provider_timestamp`,
        [q.symbol, q.price, q.providerTimestamp, provider.sourceId]);
      if (w.rowCount) result.written.push(q.symbol); else result.rejected.push({ symbol: q.symbol, reason: 'not_newer' });
    } catch (error) {
      // 23503: unknown instrument or unregistered source (foreign keys). The role cannot create either.
      if (error.code === '23503') result.rejected.push({ symbol: q.symbol, reason: 'unknown_symbol_or_source' });
      else throw error;
    }
  }
  for (const symbol of symbols) if (!answered.has(symbol)) result.rejected.push({ symbol, reason: 'missing_from_provider' });
  return result;
}
