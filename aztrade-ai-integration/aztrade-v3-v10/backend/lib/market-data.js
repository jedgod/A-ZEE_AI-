import { assertLicensedSource, sanitizeSymbol } from './core.js';

// Provider contract: fetchBars({symbol,assetClass,start,end}) -> decimal STRING OHLCV bars.
// Never create an unrestricted fetch URL from client input.
const classes = new Set(['stock','etf','crypto','forex']);
const decimal = /^(?:0|[1-9]\d{0,17})(?:\.\d{1,10})?$/;
export function validateBars(input, {symbol, start, end, maxBars=20000}) {
  if (!Array.isArray(input) || input.length > maxBars) throw new Error('BAD_BAR_COUNT');
  let last=-Infinity;
  return input.map(b=>{
    if (!b || b.symbol !== symbol || typeof b.time !== 'string') throw new Error('BAD_BAR');
    const t=Date.parse(b.time);
    if (!Number.isFinite(t) || t<=last || t<Date.parse(start) || t>Date.parse(end)) throw new Error('BAD_BAR_TIME');
    last=t;
    for (const key of ['open','high','low','close','volume']) if (typeof b[key]!=='string'||!decimal.test(b[key])) throw new Error('BAD_BAR_DECIMAL');
    const [o,h,l,c,v]=['open','high','low','close','volume'].map(k=>Number(b[k]));
    if (![o,h,l,c,v].every(Number.isFinite)||Math.min(o,h,l,c)<=0||l>Math.min(o,c,h)||h<Math.max(o,c,l)) throw new Error('BAD_OHLC');
    return Object.freeze({symbol:b.symbol,time:new Date(t).toISOString(),open:o,high:h,low:l,close:c,volume:v});
  });
}
export function createMarketDataService({registry,adapters}) {
  return {
    async historical({sourceId,symbol,assetClass,start,end,maxBars}) {
      sanitizeSymbol(symbol);
      if(!classes.has(assetClass)) throw new Error('ASSET_CLASS_UNSUPPORTED');
      if(!Number.isFinite(Date.parse(start))||!Number.isFinite(Date.parse(end))||Date.parse(start)>=Date.parse(end)||Date.parse(end)>Date.now()) throw new Error('INVALID_RANGE');
      const source=await registry.find(sourceId);
      assertLicensedSource(source,'historical');
      if(!source.assetClasses.includes(assetClass)) throw new Error('CLASS_NOT_LICENSED');
      const provider=adapters.get(sourceId);
      if(!provider) throw new Error('PROVIDER_NOT_CONFIGURED');
      const bars=validateBars(await provider.fetchBars({symbol,assetClass,start,end}),{symbol,start,end,maxBars});
      return {sourceId,assetClass,symbol,bars,asOf:new Date().toISOString(),researchOnly:true};
    }
  };
}
