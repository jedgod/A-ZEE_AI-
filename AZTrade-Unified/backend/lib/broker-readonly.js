import { httpError } from './core.js';

// A broker adapter MUST use that vendor's approved OAuth authorization-code + PKCE flow.
// No shared passwords, scraping, user-submitted tokens, or trading scopes.
export class BrokerRegistry {
  #adapters=new Map();
  register(id,adapter){
    if(!/^[a-z0-9_-]{2,40}$/.test(id)||this.#adapters.has(id))throw new Error('INVALID_BROKER');
    for(const method of ['authorizeUrl','exchangeCode','listAccounts','listPositions','revoke'])if(typeof adapter[method]!=='function')throw new Error('INCOMPLETE_BROKER_ADAPTER');
    if(adapter.readOnly!==true)throw new Error('TRADING_SCOPE_FORBIDDEN');
    this.#adapters.set(id,adapter);
  }
  get(id){const provider=this.#adapters.get(id);if(!provider)throw httpError(503,'BROKER_NOT_CONFIGURED');return provider;}
}

export function validateBrokerScopes(scopes){
  const approved=new Set(['accounts:read','positions:read','balances:read']);
  if(!Array.isArray(scopes)||scopes.length===0||scopes.some(s=>!approved.has(s)))throw new Error('BROKER_SCOPE_REFUSED');
  return scopes;
}

export function assertReadOnlyBrokerRequest(method,path){
  if(method!=='GET'||!/^\/(accounts|positions|balances)(?:\/|$)/.test(path))throw httpError(403,'BROKER_WRITE_DENIED');
}
