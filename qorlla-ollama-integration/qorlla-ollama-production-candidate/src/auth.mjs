// Qorlla adapter contract: authority must verify session, membership, suspension,
// subscription and explicit private inference entitlement. Never trust tenant headers.
export function createAuthority({url,serviceToken,fetchImpl=fetch,timeoutMs=3000}){
 if(!url||!serviceToken)throw Error('AUTHORITY_URL and AUTHORITY_SERVICE_TOKEN required');
 const endpoint=new URL(url);
 if(endpoint.protocol!=='https:' && !['localhost','127.0.0.1'].includes(endpoint.hostname))throw Error('Authority must use HTTPS');
 return async function verify(authHeader){
  if(typeof authHeader!=='string'||!/^Bearer [^\s]{16,8192}$/.test(authHeader))throw Error('unauthorized');
  const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),timeoutMs);
  try{
   const r=await fetchImpl(endpoint,{method:'POST',headers:{'authorization':`Bearer ${serviceToken}`,'content-type':'application/json'},body:JSON.stringify({access_token:authHeader.slice(7),required_permission:'ai.ollama.infer'}),signal:ctrl.signal,redirect:'error'});
   if(!r.ok)throw Error('unauthorized');
   const p=await r.json();
   if(p?.active!==true||p?.session_active!==true||p?.member_active!==true||p?.tenant_active!==true||p?.subscription_active!==true||p?.entitled!==true||typeof p.tenant_id!=='string'||!p.tenant_id||typeof p.subject_id!=='string'||!p.subject_id)throw Error('unauthorized');
   return {tenant:p.tenant_id,subject:p.subject_id};
  }finally{clearTimeout(timer)}
 };
}
