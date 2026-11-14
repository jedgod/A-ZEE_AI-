import 'server-only';
import { requireUser, strictOrigin, allow } from '@/lib/users/auth';
import { UserError } from '@/lib/users/types';
import { introspect, aztradeConfig } from '@/lib/aztrade/identity';
import { allowedProxy } from './companion-policy';

const json = (value: unknown, status: number) => Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
const BEARER = /^Bearer ([A-Za-z0-9_.-]{20,8192})$/;
/** Only fixed, operator-configured backend origins; never accept user-supplied URLs. */
function backendOrigin(): string {
  const raw = process.env.AZTRADE_BACKEND_ORIGIN;
  if (!raw) throw new Error('BACKEND_NOT_CONFIGURED');
  const u = new URL(raw);
  if (u.username || u.password || u.search || u.hash || u.pathname !== '/') throw new Error('INVALID_BACKEND_ORIGIN');
  const dev = process.env.NODE_ENV !== 'production' && u.protocol === 'http:' && ['localhost','127.0.0.1'].includes(u.hostname);
  if (u.protocol !== 'https:' && !dev) throw new Error('BACKEND_TLS_REQUIRED');
  return u.origin;
}

export async function companionGateway(request: Request, parts: string[]): Promise<Response> {
  if (process.env.AZTRADE_AI_COMPANION_ENABLED !== 'true') return json({error:'FEATURE_DISABLED'},503);
  const method = request.method;
  const route = `/api/${parts.join('/')}`;
  const allowed = allowedProxy(method,route);
  if (!allowed) return json({error:'NOT_FOUND'},404);
  try {
    if (method !== 'GET') strictOrigin(request);
    const user = await requireUser(request,method !== 'GET');
    if (!await allow('aztrade-companion',user.id,30)) return json({error:'RATE_LIMITED'},429);
    // In the native app Authorization carries the A-Zee session; AZTrade gets a separate header.
    // For older web clients we still accept Authorization as the AZTrade bearer when an HttpOnly A-Zee cookie exists.
    const token = BEARER.exec(request.headers.get('x-aztrade-token') || '')?.[1] ??
      BEARER.exec(request.headers.get('authorization') || '')?.[1];
    if (!token) return json({error:'AZTRADE_TOKEN_REQUIRED'},401);
    // A-Zee authoritative live session, plan and tenant re-check. In the browser
    // an AZTrade token is kept in memory and re-minted when expired.
    const identity = await introspect(token,aztradeConfig());
    if (!identity.active || identity.sub !== user.id) return json({error:'SESSION_REVOKED'},401);
    let body: string|undefined;
    if (method === 'POST') {
      if (!request.headers.get('content-type')?.includes('application/json')) return json({error:'JSON_REQUIRED'},415);
      body = await request.text();
      if (new TextEncoder().encode(body).byteLength > 8192) return json({error:'PAYLOAD_TOO_LARGE'},413);
      let parsed: unknown;
      try { parsed = JSON.parse(body); } catch {return json({error:'INVALID_JSON'},400);}
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return json({error:'INVALID_BODY'},400);
      const obj = parsed as Record<string,unknown>;
      if (Object.keys(obj).some(k=>!['requestId','message'].includes(k))) return json({error:'UNEXPECTED_FIELDS'},400);
      if (typeof obj.message !== 'string' || !obj.message.trim() || obj.message.length > 4000 || typeof obj.requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(obj.requestId)) return json({error:'INVALID_BODY'},400);
    }
    const upstream = await fetch(`${backendOrigin()}${allowed.destination}`,{
      method,
      headers:{authorization:`Bearer ${token}`,...(body===undefined?{}:{'content-type':'application/json'})},
      body,
      cache:'no-store',redirect:'error',signal:AbortSignal.timeout(50000)
    });
    // Never forward Set-Cookie or upstream CORS/cache headers.
    const responseText = await upstream.text();
    if (responseText.length > 256_000) return json({error:'UPSTREAM_RESPONSE_TOO_LARGE'},502);
    if (!upstream.headers.get('content-type')?.includes('application/json')) return json({error:'UPSTREAM_INVALID_RESPONSE'},502);
    try { JSON.parse(responseText); } catch {return json({error:'UPSTREAM_INVALID_JSON'},502);}
    return new Response(responseText,{status:upstream.status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
  } catch (e) {
    // A missing or expired A-Zee sign-in, or a rate limit, keeps its own status so the client can react (sign in again / wait).
    if (e instanceof UserError && [401,403,429].includes(e.status)) return json({error:e.code},e.status);
    console.error('AZTrade companion gateway refused:',e instanceof Error?e.name:'error');
    return json({error:'AZTRADE_UNAVAILABLE'},503);
  }
}
