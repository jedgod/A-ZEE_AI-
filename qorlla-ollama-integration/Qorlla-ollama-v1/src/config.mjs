export function config(env=process.env) {
  const required = ['DATABASE_URL','JWKS_URL','JWT_ISSUER','JWT_AUDIENCE','OLLAMA_BASE_URL','OLLAMA_MODELS'];
  for (const key of required) if (!env[key]) throw new Error(`Missing ${key}`);
  const url = new URL(env.OLLAMA_BASE_URL);
  if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Invalid OLLAMA_BASE_URL');
  if (!['ollama','localhost','127.0.0.1','::1'].includes(url.hostname) && !env.OLLAMA_ALLOW_PRIVATE_HOST) throw new Error('Ollama host must be explicitly approved');
  const models = env.OLLAMA_MODELS.split(',').map(x=>x.trim()).filter(Boolean);
  if (!models.length || models.some(x=> !/^[a-zA-Z0-9._:\/-]{1,120}$/.test(x))) throw new Error('Invalid model allowlist');
  const int=(k,d,min,max)=>{const v=Number(env[k]??d);if(!Number.isSafeInteger(v)||v<min||v>max)throw new Error(`Invalid ${k}`);return v};
  return Object.freeze({ databaseUrl:env.DATABASE_URL, jwksUrl:env.JWKS_URL, issuer:env.JWT_ISSUER, audience:env.JWT_AUDIENCE, ollamaUrl:url.origin, models:new Set(models), port:int('PORT',8090,1,65535), timeoutMs:int('OLLAMA_TIMEOUT_MS',45000,1000,120000), maxTokens:int('OLLAMA_MAX_OUTPUT_TOKENS',1024,1,4096), maxInputChars:int('OLLAMA_MAX_INPUT_CHARS',16000,1,64000), maxDailyRequests:int('OLLAMA_DAILY_REQUESTS',100,1,100000), maxConcurrent:int('OLLAMA_MAX_CONCURRENT',8,1,1000), enabled:env.OLLAMA_ENABLED==='true', tlsRejectUnauthorized: true });
}
