/** AZTrade AI launch policy. Never equate visibility with authority to trade. */
export type Market = 'stocks'|'etfs'|'crypto'|'forex'|'commodities'|'options'|'futures';
export type Capability = {
  researchAssistant: boolean;
  brokerConnections: 'unavailable'|'read_only';
  marketData: 'unavailable'|'licensed';
  historicalBacktests: 'unavailable'|'certified';
  paperExecution: false;
  liveExecution: false;
  markets: Record<Market,'education_only'|'licensed_research'>;
};
export function companionCapabilities(): Capability {
  const education = 'education_only' as const;
  return {
    researchAssistant: true,
    brokerConnections:'unavailable',
    marketData:'unavailable',
    historicalBacktests:'unavailable',
    paperExecution:false,
    liveExecution:false,
    markets:{stocks:education,etfs:education,crypto:education,forex:education,commodities:education,options:education,futures:education}
  };
}
export const ALLOWED_PROXY = {
  'GET /api/paper': { destination: '/api/paper', feature: 'portfolio' },
  'GET /api/portfolio': { destination: '/api/portfolio', feature: 'portfolio' },
  'GET /api/risk': { destination: '/api/risk', feature: 'risk' },
  'GET /api/assistant/history': { destination:'/api/assistant/history', feature: 'assistant' },
  'POST /api/assistant/chat': { destination: '/api/assistant/chat', feature: 'assistant' },
} as const;
export function allowedProxy(method: string, path: string) {
  return ALLOWED_PROXY[`${method} ${path}` as keyof typeof ALLOWED_PROXY] ?? null;
}
