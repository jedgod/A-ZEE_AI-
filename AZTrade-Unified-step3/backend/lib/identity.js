import { createRemoteJWKSet, jwtVerify } from 'jose';

let cache;
const timeout = ms => AbortSignal.timeout(ms);
function httpsEndpoint(raw, name) {
  if (!raw) throw new Error(`${name} missing`);
  const url = new URL(raw);
  if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname))) throw new Error(`${name} must use HTTPS`);
  return url;
}
import {mapPlan} from './plans.js';
import {mtlsConfigured, mtlsFetcher} from './mtls-client.js';
export async function authenticateAzee(token, {fetcher} = {}) {
  // Production: introspection is service-to-service over mTLS ONLY. No client certificate configured => refuse (fail closed).
  if (!fetcher) {
    if (mtlsConfigured()) fetcher = mtlsFetcher();
    else if (process.env.NODE_ENV === 'production') throw new Error('Introspection mTLS not configured');
    else fetcher = fetch;
  }
  if (typeof token !== 'string' || token.length > 8192 || token.length < 20) throw new Error('Invalid bearer token');
  const issuer = process.env.AZEE_JWT_ISSUER, audience = process.env.AZEE_JWT_AUDIENCE;
  if (!issuer || !audience) throw new Error('JWT configuration missing');
  const jwks = httpsEndpoint(process.env.AZEE_JWKS_URL, 'JWKS');
  const introspect = httpsEndpoint(process.env.AZEE_INTROSPECTION_URL, 'Introspection');
  if (!process.env.AZEE_INTROSPECTION_TOKEN) throw new Error('Introspection credential missing');
  if (!cache || cache.url !== jwks.href) cache = {url: jwks.href, keyset: createRemoteJWKSet(jwks, { timeoutDuration: 5000, cooldownDuration: 30000 })};
  const { payload } = await jwtVerify(token, cache.keyset, {issuer, audience, algorithms:['RS256'], clockTolerance: 5, maxTokenAge: '6m'});
  if (!payload.sub || !payload.jti || !payload.sid || !payload.exp) throw new Error('Incomplete identity token');
  const response = await fetcher(introspect, { method: 'POST', headers: {authorization: `Bearer ${process.env.AZEE_INTROSPECTION_TOKEN}`, 'content-type':'application/json'}, body: JSON.stringify({ token }), signal: timeout(5000) });
  if (!response.ok) throw new Error('Introspection failed');
  const state = await response.json();
  if (state.active !== true || state.sub !== payload.sub || state.jti !== payload.jti || state.sid !== payload.sid || !state.tenant_id || !state.session_active) throw new Error('Revoked or mismatched session');
  return { sub: payload.sub, tenant_id: String(state.tenant_id), tier: mapPlan(state.plan, state.subscription_status), session_id: payload.sid };
}
