import type { Asset, AlertRow, CatalogItem, History, QuoteInfo, Range, Rule, RuleType, Recurrence, Spark } from './logic';

/** Browser calls to A-Zee's own API. The signed-in session cookie authenticates them; writes also pass the server's same-origin check. */
export class ApiFail extends Error {
  constructor(public status: number, public code: string) { super(code); this.name = 'ApiFail'; }
}

async function call<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? 'GET', credentials: 'same-origin', cache: 'no-store', signal: init.signal,
      headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (e) { if ((e as Error).name === 'AbortError') throw e; throw new ApiFail(0, 'NETWORK_UNAVAILABLE'); }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiFail(res.status, typeof json?.error === 'string' ? json.error : 'REQUEST_FAILED');
  return (json && typeof json === 'object' && 'data' in json ? json.data : json) as T;
}

const MESSAGES: Record<string, string> = {
  RULE_LIMIT_REACHED: 'You can have up to 15 monitors. Delete one to add another.',
  PERCENT_NOT_SUPPORTED: 'Percent rules need crypto or stocks. Use a price rule for forex and commodities.',
  INVALID_SYMBOL: "That symbol isn't valid.", INVALID_THRESHOLD: 'Enter a number above zero (percent rules: up to 100).', INVALID_REQUEST: 'Check the symbol and number.',
  RATE_LIMITED: 'Too many requests. Wait a moment.', SIGN_IN_REQUIRED: 'Sign in to your A-Zee account to continue.', NETWORK_UNAVAILABLE: "Can't reach the server. Check your connection.",
  RANGE_NOT_AVAILABLE: 'This source has daily data only. Pick 1W or longer.',
  PROVIDER_NOT_CONFIGURED: 'No data source is set up for this asset on the server yet.',
  QUOTE_UNAVAILABLE: 'No data came back for this asset right now.', EXTERNAL_DATA_DISABLED: 'Market lookups are off while the server is in private mode.',
  FUTURES_NOT_CONFIGURED: 'Futures are not supported yet.',
};
export const explain = (e: unknown) => MESSAGES[(e as ApiFail)?.code ?? ''] ?? ((e as Error)?.message && !(e instanceof ApiFail) ? (e as Error).message : 'Something went wrong.');
export const REASONS: Record<string, string> = { PROVIDER_NOT_CONFIGURED: 'No data source set up', QUOTE_UNAVAILABLE: 'No quote right now', FUTURES_NOT_CONFIGURED: 'Not supported yet', EXTERNAL_DATA_DISABLED: 'Private mode is on', INVALID_SYMBOL: 'Invalid symbol', RATE_LIMITED: 'Too many lookups' };

let catalog: CatalogItem[] | null = null;
let inflight: Promise<CatalogItem[]> | null = null;
export async function loadCatalog(): Promise<CatalogItem[]> {
  if (catalog) return catalog;
  inflight ??= call<{ results: CatalogItem[] }>('/api/finance/symbols').then(r => (catalog = r.results)).finally(() => { inflight = null; });
  return inflight;
}

export const fetchQuotes = (items: Asset[]) =>
  call<{ results: { symbol: string; quote?: QuoteInfo; error?: string }[] }>('/api/finance/quotes', { method: 'POST', body: { items: items.map(i => ({ symbol: i.symbol, assetClass: i.assetClass })) } });
export const fetchHistory = (a: Asset, range: Range, candles: boolean, signal?: AbortSignal) =>
  call<History>('/api/finance/history', { method: 'POST', body: { symbol: a.symbol, assetClass: a.assetClass, range, ...(candles ? { candles: true } : {}) }, signal });
export const fetchSparklines = (items: Asset[]) =>
  call<{ results: Spark[] }>('/api/finance/sparklines', { method: 'POST', body: { items: items.map(i => ({ symbol: i.symbol, assetClass: i.assetClass })) } });

export const listMonitors = () => call<{ rules: Rule[]; alerts: AlertRow[] }>('/api/finance/monitor');
export const createMonitor = (b: { symbol: string; assetClass: string; ruleType: RuleType; threshold: number; recurrence: Recurrence }) =>
  call<{ rule: Rule }>('/api/finance/monitor', { method: 'POST', body: b });
export const patchMonitor = (id: string, b: { status: 'active' | 'paused' } | { ruleType?: RuleType; threshold?: number; recurrence?: Recurrence }) =>
  call<{ rule: Rule }>(`/api/finance/monitor/${id}`, { method: 'PATCH', body: b });
export const deleteMonitor = (id: string) => call<{ id: string }>(`/api/finance/monitor/${id}`, { method: 'DELETE' });
export const unreadCount = () => call<{ count: number }>('/api/notifications/unread-count');
export const currentUser = () => call<{ user: { id: string; name: string; email: string } | null }>('/api/auth/me');
