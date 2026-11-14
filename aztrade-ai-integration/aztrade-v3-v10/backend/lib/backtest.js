// Deterministic educational daily-bar simulator: signals at previous close, fills at next open.
// Long-only, one symbol, fixed fractional exposure. Not a multi-asset or derivative engine.
export function backtest({bars,strategy='momentum',lookback=10,cash=10000,feeBps=10,slippageBps=5}) {
  if(!['momentum','mean_reversion'].includes(strategy)||!Number.isInteger(lookback)||lookback<2||lookback>250||bars.length<lookback+2||bars.length>20000) throw new Error('INVALID_BACKTEST');
  if(![cash,feeBps,slippageBps].every(Number.isFinite)||cash<=0||cash>1e8||feeBps<0||feeBps>500||slippageBps<0||slippageBps>500) throw new Error('INVALID_COSTS');
  for(let i=0;i<bars.length;i++){
    const b=bars[i];
    if(!b||![b.open,b.high,b.low,b.close].every(x=>Number.isFinite(x)&&x>0))throw new Error('INVALID_BARS');
    if(i && !(bars[i-1].time < b.time)) throw new Error('UNSORTED_BARS');
  }
  let balance=cash,shares=0,orders=0,peak=cash,maxDrawdownPct=0;
  const equityCurve=[];const fees=feeBps/10000,slip=slippageBps/10000;
  for(let i=lookback;i<bars.length;i++){
    const history=bars.slice(i-lookback,i);
    const avg=history.reduce((s,b)=>s+b.close,0)/lookback;
    const signal=history.at(-1).close > avg;
    const wantLong=strategy==='momentum'?signal:!signal;
    if(wantLong && !shares){
      const px=bars[i].open*(1+slip);
      const units=Math.floor((balance/(px*(1+fees)))*1e6)/1e6;
      if(units>0){balance-=units*px*(1+fees);shares=units;orders++;}
    }else if(!wantLong && shares){balance+=shares*bars[i].open*(1-slip)*(1-fees);shares=0;orders++;}
    const equity=balance+shares*bars[i].close;
    peak=Math.max(peak,equity);
    maxDrawdownPct=Math.max(maxDrawdownPct,100*(peak-equity)/peak);
    equityCurve.push({time:bars[i].time,equity});
  }
  const finalEquity=equityCurve.at(-1).equity;
  return {strategy,initialCash:cash,finalEquity,returnPct:100*(finalEquity/cash-1),maxDrawdownPct,orders,equityCurve,
    assumptions:['next-bar-open execution','fixed fees/slippage','long-only','no leverage','no corporate action adjustments in engine','no dividends or taxes']};
}
