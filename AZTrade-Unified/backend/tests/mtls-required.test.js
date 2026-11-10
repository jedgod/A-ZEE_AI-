import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticateAzee } from '../lib/identity.js';

// Production must never fall back to a plain bearer-only introspection call.
test('production refuses to introspect without a configured mTLS client certificate', async () => {
  const saved = { ...process.env };
  Object.assign(process.env, { NODE_ENV: 'production', AZEE_JWT_ISSUER: 'https://issuer.invalid', AZEE_JWT_AUDIENCE: 'a', AZEE_JWKS_URL: 'https://issuer.invalid/jwks', AZEE_INTROSPECTION_URL: 'https://issuer.invalid/introspect', AZEE_INTROSPECTION_TOKEN: 'x'.repeat(40) });
  for (const k of ['CERT', 'KEY', 'CA']) delete process.env[`AZEE_INTROSPECTION_MTLS_${k}_FILE`];
  try { await assert.rejects(authenticateAzee('t'.repeat(40)), /mTLS not configured/); }
  finally { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved); }
});
