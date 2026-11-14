export function portfolioIntelligence(positions, quotes, baseCurrency='USD') {
  if(!Array.isArray(positions)||positions.length>500||!['USD'].includes(baseCurrency)) throw new Error('INVALID_PORTFOLIO');
  const breakdown=[];const missing=[];
  let value=0;
  for(const p of positions){
    if(!p||typeof p.symbol!=='string'||typeof p.assetClass!=='string'||!Number.isFinite(Number(p.quantity))||Number(p.quantity)<0) throw new Error('BAD_POSITION');
    const q=quotes.get(p.symbol);
    if(!q || !q.verified || q.currency!==baseCurrency || !Number.isFinite(Number(q.price)) || Number(q.price)<=0){missing.push(p.symbol);continue;}
    const v=Number(p.quantity)*Number(q.price);
    if(!Number.isFinite(v)) throw new Error('POSITION_OVERFLOW');
    value+=v;breakdown.push({symbol:p.symbol,assetClass:p.assetClass,marketValue:v});
  }
  // Do not publish percentages as complete if any holding lacks a verified quote.
  if(missing.length) return {status:'incomplete',missingSymbols:missing,valuedPositions:breakdown,totals:null};
  const byClass={};
  for(const b of breakdown) byClass[b.assetClass]=(byClass[b.assetClass]||0)+b.marketValue;
  return {status:'complete',missingSymbols:[],totals:{currency:baseCurrency,marketValue:value,largestPositionPct:value?100*Math.max(0,...breakdown.map(b=>b.marketValue))/value:0,byAssetClassPct:Object.fromEntries(Object.entries(byClass).map(([k,v])=>[k,value?100*v/value:0]))},valuedPositions:breakdown};
}
