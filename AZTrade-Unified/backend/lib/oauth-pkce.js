import { randomBytes, createHash } from 'node:crypto';

function base64url(bytes){return Buffer.from(bytes).toString('base64url');}
export function createPkceAuthorization() {
  const verifier=base64url(randomBytes(48));
  const challenge=base64url(createHash('sha256').update(verifier).digest());
  const state=base64url(randomBytes(32));
  return {verifier,challenge,state,method:'S256'};
}
// Session store must be Redis/PostgreSQL, encrypted at rest and shared across replicas.
// This class requires a server-authoritative state store, not localStorage or in-memory Map.
export class BrokerOAuthFlow {
  constructor({brokerRegistry,stateStore,tokenVault,redirectAllowlist}) {
    if(!brokerRegistry||!stateStore||!tokenVault||!Array.isArray(redirectAllowlist))throw new Error('OAUTH_UNCONFIGURED');
    this.brokers=brokerRegistry;this.store=stateStore;this.vault=tokenVault;this.redirectAllowlist=new Set(redirectAllowlist);
  }
  async begin({providerId,userId,tenantId,redirectUri}){
    if(!this.redirectAllowlist.has(redirectUri))throw new Error('OAUTH_REDIRECT_DENIED');
    const adapter=this.brokers.get(providerId);
    const {verifier,challenge,state}=createPkceAuthorization();
    await this.store.create(createHash('sha256').update(state).digest('hex'),{
      providerId,userId,tenantId,redirectUri,verifier,expiresAt:Date.now()+5*60*1000
    },300); // atomic create, ttl 300s
    return {url:await adapter.authorizeUrl({state,challenge,challengeMethod:'S256',redirectUri,scopes:['accounts:read','positions:read','balances:read']}),expiresIn:300};
  }
  async complete({state,code,userId,tenantId}){
    if(typeof state!=='string'||state.length>256||typeof code!=='string'||!code||code.length>4096)throw new Error('OAUTH_INVALID_RESPONSE');
    const key=createHash('sha256').update(state).digest('hex');
    const pending=await this.store.consume(key); // atomic take-once; no replay
    if(!pending || pending.expiresAt<Date.now() || pending.userId!==userId || pending.tenantId!==tenantId)throw new Error('OAUTH_STATE_INVALID');
    const adapter=this.brokers.get(pending.providerId);
    const tokens=await adapter.exchangeCode({code,verifier:pending.verifier,redirectUri:pending.redirectUri});
    // Tokens are never returned to the frontend or persisted to application database.
    const ref=await this.vault.put({providerId:pending.providerId,userId,tenantId,tokens});
    return {providerId:pending.providerId,secretReference:ref,readOnly:true};
  }
}
