// Shared helpers for the PostgreSQL certification tests. These run ONLY against the disposable instance
// described by the config file written by scripts/cert-provision.mjs (AZTRADE_CERT_CONFIG).
import fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const configPath = process.env.AZTRADE_CERT_CONFIG;
export const config = configPath && process.env.AZTRADE_CERT_DISPOSABLE === 'YES' && fs.existsSync(configPath)
  ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : null;
export const enabled = Boolean(config?.disposable);

const pg = enabled ? (await import('pg')).default : null;
const make = (url, max) => new pg.Pool({ connectionString: url, max, connectionTimeoutMillis: 15000 });
export const pools = enabled ? {
  app: make(config.appUrl, 24),            // the restricted runtime role
  prov: make(config.provisionerUrl, 4),    // identity/account provisioning only
  owner: make(config.ownerUrl, 4),         // reference-data arrangement for tests (quote ages)
} : {};
for (const p of Object.values(pools)) p.on('error', () => { /* a deliberate server crash surfaces on the next query */ });
export async function closePools() { await Promise.allSettled(Object.values(pools).map(p => p.end())); }

// ---- exact decimal arithmetic, independent of PostgreSQL (scaled BigInt, 8 decimals) ----
const SCALE = 8n;
const ONE = 10n ** SCALE;
export function toUnits(text) {                     // "12.345" -> 1234500000n
  const m = /^(-?)(\d+)(?:\.(\d{1,8}))?$/.exec(String(text));
  if (!m) throw new Error(`bad decimal ${text}`);
  const whole = BigInt(m[2]) * ONE; const frac = BigInt((m[3] ?? '').padEnd(8, '0') || '0');
  return (m[1] ? -1n : 1n) * (whole + frac);
}
export function fromUnits(u) {                      // 1234500000n -> "12.345"
  const neg = u < 0n; const a = neg ? -u : u;
  const s = `${a / ONE}.${(a % ONE).toString().padStart(8, '0')}`.replace(/\.?0+$/, '') || '0';
  return (neg ? '-' : '') + s;
}
/** round(shares * price, 8), half away from zero (positive values only here) — the posting's single rounding. */
export const notionalUnits = (shares, price) => (toUnits(shares) * toUnits(price) + ONE / 2n) / ONE;

// ---- identity and transactions ----
export const hashOrder = (symbol, side, shares) =>
  createHash('sha256').update(JSON.stringify({ symbol, side, shares })).digest('hex');

export async function inContext(pool, identity, fn, { commit = true } = {}) {
  const c = await pool.connect();
  const onError = () => { /* the failing query rejects separately; with no listener Node treats this event as uncaught */ };
  c.on('error', onError);
  let dead = false;
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.current_user_id', $1, true)", [identity.userId]);
    await c.query("SELECT set_config('app.current_tenant', $1, true)", [identity.tenant]);
    const out = await fn(c);
    await c.query(commit ? 'COMMIT' : 'ROLLBACK');
    return out;
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch { dead = true; } // if even ROLLBACK fails the connection is gone: discard it
    throw e;
  } finally { c.removeListener('error', onError); c.release(dead); }
}

/** Retries a harness operation through a server restart. Only connection-level errors are retried; business errors never are. */
export async function resilient(fn, attempts = 12) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (e) {
      if (!/ECONNRESET|EPIPE|ECONNREFUSED|Connection terminated|57P0[123]|08\d{3}/.test(String(e.code) + ' ' + e.message)) throw e;
      last = e; await sleep(400);
    }
  }
  throw last;
}

/** Creates a user, portfolio and paper account the way the provisioning service would (under its own role, with the user's context). */
export const provisionUser = (opts) => resilient(() => provisionUserOnce(opts));
async function provisionUserOnce({ tenant = `t-${randomUUID()}`, cash = '100000' } = {}) {
  const userId = randomUUID();
  const identity = { userId, tenant };
  const accountId = await inContext(pools.prov, identity, async c => {
    await c.query('INSERT INTO users (id, azee_user_id, tenant_id, tier) VALUES ($1, $2, $3, $4)', [userId, `azee-${randomUUID()}`, tenant, 'plus']);
    await c.query('INSERT INTO portfolios (user_id) VALUES ($1)', [userId]);
    const { rows } = await c.query('INSERT INTO paper_accounts (user_id, cash) VALUES ($1, $2::numeric) RETURNING id', [userId, cash]);
    return rows[0].id;
  });
  return { ...identity, accountId, opening: cash };
}

/** Places one order through the posting procedure; returns { replay, order } or throws the PostgreSQL error (with .code). */
export async function placeOrder(identity, { symbol, side, shares, key }, pool = pools.app) {
  return inContext(pool, identity, async c => {
    const { rows } = await c.query('SELECT aztrade_place_paper_order($1, $2, $3::numeric, $4, $5) AS r',
      [symbol, side, shares, key, hashOrder(symbol, side, shares)]);
    return rows[0].r;
  });
}

export const reconcile = (identity, pool = pools.app) => resilient(() => inContext(pool, identity, async c => {
  const { rows } = await c.query('SELECT * FROM aztrade_reconcile_paper_account((SELECT id FROM paper_accounts WHERE user_id = $1))', [identity.userId]);
  return rows;
}));

export const snapshot = (identity, pool = pools.app) => resilient(() => inContext(pool, identity, async c => {
  const { rows: [a] } = await c.query('SELECT id, cash::text AS cash, opening_cash::text AS opening FROM paper_accounts WHERE user_id = $1', [identity.userId]);
  const { rows: positions } = await c.query('SELECT symbol, shares::text AS shares FROM paper_positions WHERE account_id = $1 ORDER BY symbol', [a.id]);
  const { rows: [o] } = await c.query('SELECT count(*)::int AS n FROM paper_orders WHERE account_id = $1', [a.id]);
  const { rows: [l] } = await c.query('SELECT count(*)::int AS n FROM paper_ledger WHERE account_id = $1', [a.id]);
  return { cash: a.cash, opening: a.opening, positions, orders: o.n, ledger: l.n };
}));

/** Arranges reference data as the owner (the app role cannot write quotes): price and age in seconds. */
export const TEST_SOURCE = 'cert-fixture';
/** Registers the test-only licensed source (owner decision in production; a fixture here). NOT a real licence. */
export async function ensureTestSource() {
  await resilient(() => pools.owner.query(`INSERT INTO market_data_sources (id, name, license_status, license_reference, allows_execution)
    VALUES ($1, 'Certification test fixture (not market data)', 'licensed', 'CERT-TEST-ONLY-NOT-A-REAL-LICENCE', true) ON CONFLICT (id) DO NOTHING`, [TEST_SOURCE]));
}
export async function setQuote(symbol, price, ageSeconds = 0) {
  await ensureTestSource();
  await resilient(() => pools.owner.query(`UPDATE market_prices SET price = $2::numeric, source_id = $4,
    updated_at = now() - make_interval(secs => $3::int), provider_timestamp = now() - make_interval(secs => $3::int) WHERE symbol = $1`, [symbol, price, ageSeconds, TEST_SOURCE]));
}

/** Independent expectation for an account, computed with BigInt from the order list alone. */
export function expectedState(opening, fills) {
  let cash = toUnits(opening); const held = new Map();
  for (const f of fills) {
    const n = notionalUnits(f.shares, f.price);
    if (f.side === 'BUY') { cash -= n; held.set(f.symbol, (held.get(f.symbol) ?? 0n) + toUnits(f.shares)); }
    else { cash += n; held.set(f.symbol, (held.get(f.symbol) ?? 0n) - toUnits(f.shares)); }
  }
  return { cash: fromUnits(cash), positions: [...held].filter(([, v]) => v !== 0n).map(([symbol, v]) => ({ symbol, shares: fromUnits(v) })).sort((a, b) => a.symbol.localeCompare(b.symbol)) };
}

// ---- server control for crash/restart tests ----
export function pgctl(...args) {
  if (!config?.pgCtl || !config?.dataDir) throw new Error('pgCtl/dataDir missing from the certification config');
  const r = spawnSync(config.pgCtl, ['-D', config.dataDir, ...args], { encoding: 'utf8', timeout: 120000 });
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}
/** Adds an instrument + fresh quote for a test (owner role). Dedicated symbols keep test files from interfering. */
export async function createInstrument(symbol, price) {
  await pools.owner.query(`INSERT INTO instruments (symbol, name, type) VALUES ($1, $1, 'stock') ON CONFLICT (symbol) DO UPDATE SET active = true`, [symbol]);
  await ensureTestSource();
  await pools.owner.query(`INSERT INTO market_prices (symbol, price, updated_at, provider_timestamp, source_id) VALUES ($1, $2::numeric, now(), now(), $3)
    ON CONFLICT (symbol) DO UPDATE SET price = EXCLUDED.price, updated_at = now(), provider_timestamp = now(), source_id = $3`, [symbol, price, TEST_SOURCE]);
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function waitForServer(url, timeoutMs = 90000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 3000 });
    try { await c.connect(); await c.query('SELECT 1'); await c.end(); return; }
    catch (e) { try { await c.end(); } catch { /* ignore */ } if (Date.now() > end) throw e; await sleep(500); }
  }
}
