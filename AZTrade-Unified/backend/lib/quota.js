import { mtlsConfigured, mtlsFetcher } from './mtls-client.js';

// Daily backtest quota. The count and the limit live in A-Zee (its PostgreSQL and its live subscription): this backend
// only asks A-Zee to reserve a slot before it runs, and to give it back if the run fails. If A-Zee cannot be reached
// the work is refused (fail closed), never run unmetered.

export class QuotaUnavailableError extends Error { constructor(message = 'quota service unavailable') { super(message); this.name = 'QuotaUnavailableError'; } }

function endpoint() {
  const explicit = process.env.AZEE_QUOTA_URL;
  const derived = process.env.AZEE_INTROSPECTION_URL?.replace(/\/introspect\/?$/, '/quota');
  const raw = explicit || derived;
  if (!raw) throw new QuotaUnavailableError('AZEE_QUOTA_URL is not configured');
  return new URL(raw);
}

async function call(payload) {
  let fetcher = fetch;
  if (mtlsConfigured()) fetcher = mtlsFetcher();
  else if (process.env.NODE_ENV === 'production') throw new QuotaUnavailableError('quota mTLS not configured');
  const token = process.env.AZEE_INTROSPECTION_TOKEN;
  if (!token) throw new QuotaUnavailableError('service credential missing');
  let response;
  try {
    response = await fetcher(endpoint(), { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(5000) });
  } catch (e) { throw new QuotaUnavailableError(e.message); }
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

const real = {
  /** -> { allowed, used, limit, remaining, replay }. Throws QuotaUnavailableError unless A-Zee answered 200 or 429. */
  async reserve(userId, feature, requestId) {
    const { status, body } = await call({ userId, feature, requestId, action: 'reserve' });
    if (status !== 200 && status !== 429) throw new QuotaUnavailableError(`quota service answered ${status}`);
    return body;
  },
  async refund(userId, feature, requestId) {
    const { status } = await call({ userId, feature, requestId, action: 'refund' });
    return status === 200;
  },
};

let client = real;
export const getQuota = () => client;
/** Tests only. */
export function setQuotaClient(next) { client = next ?? real; }
