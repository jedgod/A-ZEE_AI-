import { ProviderUnavailableError } from './provider-error.js';
// The adapter's API endpoint and key are server-only; never take a request URL from a user.
// A real provider mapping is required because vendor JSON response schemas differ.
export class LicensedHttpHistoricalProvider {
  constructor({baseUrl,apiKey,mapper,sourceId,allowedHosts}){
    const u=new URL(baseUrl);
    if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||!allowedHosts?.includes(u.hostname)||typeof mapper!=='function'||!apiKey||!sourceId)throw new Error('INVALID_PROVIDER_CONFIGURATION');
    this.baseUrl=u;this.apiKey=apiKey;this.mapper=mapper;this.sourceId=sourceId;
  }
  async fetchBars({symbol,assetClass,start,end}){
    const u=new URL('historical',this.baseUrl);
    u.searchParams.set('symbol',symbol);u.searchParams.set('assetClass',assetClass);u.searchParams.set('start',start);u.searchParams.set('end',end);
    let response;
    try{response=await fetch(u,{headers:{authorization:`Bearer ${this.apiKey}`,accept:'application/json'},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});}
    catch{throw new ProviderUnavailableError();}
    if(!response.ok)throw new ProviderUnavailableError(`Upstream status ${response.status}`);
    const body=await response.text();
    if(body.length>4_000_000)throw new ProviderUnavailableError('Upstream response too large');
    try{return this.mapper(JSON.parse(body));}catch{throw new ProviderUnavailableError('Provider data invalid');}
  }
}
