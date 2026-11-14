import {describe,it,expect} from 'vitest';
import {allowedProxy,companionCapabilities} from '../lib/aztrade/companion-policy';
describe('AZTrade AI launch safety policy',()=>{
  it('disables every execution pathway',()=>{
    const p=companionCapabilities();
    expect(p.liveExecution).toBe(false);
    expect(p.paperExecution).toBe(false);
    expect(p.brokerConnections).toBe('unavailable');
    expect(p.marketData).toBe('unavailable');
  });
  it('permits only an explicit read/research gateway allowlist',()=>{
    expect(allowedProxy('POST','/api/assistant/chat')).not.toBeNull();
    expect(allowedProxy('POST','/api/paper/orders')).toBeNull();
    expect(allowedProxy('GET','/api/markets')).toBeNull();
    expect(allowedProxy('POST','/api/strategies/momentum/backtest')).toBeNull();
    expect(allowedProxy('GET','/api/../../secrets')).toBeNull();
    expect(allowedProxy('GET','/api/intelligence/status')).not.toBeNull();
    expect(allowedProxy('GET','/api/intelligence/portfolio/risk')).not.toBeNull();
    expect(allowedProxy('GET','/api/intelligence/brokers')).not.toBeNull();
    for (const blocked of [['POST','/api/intelligence/historical/backtest'],['POST','/api/intelligence/brokers/connect'],['POST','/api/intelligence/brokers/orders'],['POST','/api/intelligence/status']]) expect(allowedProxy(blocked[0],blocked[1])).toBeNull();
  });
});
