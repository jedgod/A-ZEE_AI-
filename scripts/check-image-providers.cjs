// Local HTTP + PostgreSQL smoke check. Default sends no external image.
// --live-classifier explicitly sends one generated test image to Sightengine (may consume quota).
// Creates one temporary account/session and removes it and all owned rows in finally.
const assert = require('node:assert/strict');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const { Client } = require('pg');
const sharp = require('sharp');
require('@next/env').loadEnvConfig(process.cwd());
const liveClassifier = process.argv.includes('--live-classifier');
const base = process.env.CHECK_BASE_URL || process.env.APP_ORIGIN || 'http://localhost:3001';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname)) throw new Error('Smoke check requires a loopback server.');

(async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  await db.connect();
  const owner = randomUUID();
  const token = randomBytes(32).toString('hex');
  const headers = { Origin: base, Authorization: `Bearer ${token}`, 'X-AZ-Client': 'mobile' };
  const request = (path, init = {}) => fetch(base + path, { ...init, headers: { ...headers, ...init.headers }, signal: AbortSignal.timeout(120_000) });
  try {
    for (const name of ['047_image_provider_requests.sql', '048_image_provider_usage.sql']) assert.equal((await db.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name])).rowCount, 1);
    await db.query("INSERT INTO users(id,email,name,avatar_initials,email_verified_at) VALUES($1,$2,'Image check smoke','IC',now())", [owner, `image-check-${owner}@example.invalid`]);
    await db.query("INSERT INTO user_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '10 minutes')", [createHash('sha256').update(token).digest('hex'), owner]);
    const cap = await request('/api/vision/capabilities');
    assert.equal(cap.status, 200);
    const capabilities = (await cap.json()).data;
    assert.equal(capabilities.aiLikelihoodEstimator.supported, true);
    assert.equal(capabilities.internetSearch.supported, true);
    assert.equal(capabilities.platformDiscovery.privateContent, false);
    if (liveClassifier) assert.equal(capabilities.aiLikelihoodEstimator.configured, true, 'Server has not loaded Sightengine configuration.');
    const image = await sharp({ create: { width: 512, height: 512, channels: 3, background: '#135' } }).png().toBuffer();
    const form = new FormData();
    form.set('file', new Blob([image], { type: 'image/png' }), 'smoke.png');
    form.set('googleConsent', 'false'); form.set('classifierConsent', String(liveClassifier)); form.set('discoveryConsent', 'false');
    const response = await request('/api/vision/detect-ai', { method: 'POST', body: form });
    const body = await response.json();
    assert.equal(response.status, 200, body.error);
    const scan = body.data;
    assert.equal(scan.verification.evidenceVersion, 2);
    for (const key of ['google', 'discovery']) assert.equal(scan.verification[key].status, 'skipped');
    assert.equal(scan.verification.classification.status, liveClassifier ? 'checked' : 'skipped', scan.verification.classification.reason);
    if (liveClassifier) assert.equal(scan.verification.classification.provider, 'sightengine');
    assert.deepEqual(scan.verification.consent, { googleGemini: false, sightengine: liveClassifier, googleVision: false });
    const saved = await db.query('SELECT verification FROM image_scans WHERE id=$1 AND owner_id=$2', [scan.scanId, owner]);
    assert.deepEqual(saved.rows[0].verification.consent, scan.verification.consent);
    assert.equal((await db.query('SELECT 1 FROM image_provider_requests WHERE owner_id=$1', [owner])).rowCount, liveClassifier ? 1 : 0);
    if (liveClassifier) {
      assert.equal((await db.query('SELECT status FROM image_provider_requests WHERE owner_id=$1', [owner])).rows[0].status, 'completed');
      assert.deepEqual(saved.rows[0].verification.classification, scan.verification.classification);
    }
    const history = await request('/api/vision/scans');
    assert.equal(history.status, 200);
    assert.equal((await history.json()).data.scans[0].scanId, scan.scanId);
    const invalid = new FormData(); invalid.set('file', new Blob([image]), 'smoke.png'); invalid.append('discoveryConsent', 'true'); invalid.append('discoveryConsent', 'false');
    assert.equal((await request('/api/vision/detect-ai', { method: 'POST', body: invalid })).status, 400);
    assert.equal((await request('/api/vision/detect-ai', { method: 'POST', headers: { Origin: 'https://foreign.invalid' }, body: form })).status, 403);
    const unauthorized = await fetch(base + '/api/vision/capabilities', { signal: AbortSignal.timeout(20_000) });
    assert.equal(unauthorized.status, 401);
    console.log(JSON.stringify({ ok: true, base, liveClassifier, classification: liveClassifier ? { provider: scan.verification.classification.provider, status: scan.verification.classification.status } : undefined, checks: ['migration', 'authenticated capabilities', liveClassifier ? 'live classifier upload' : 'all-false upload', 'database persistence', 'history reload', liveClassifier ? 'completed consented provider lease' : 'no provider lease without consent', 'duplicate-consent rejection', 'foreign-origin rejection', 'unauthenticated rejection'], configured: { classifier: capabilities.aiLikelihoodEstimator.configured, discovery: capabilities.internetSearch.configured } }));
  } finally {
    await db.query('DELETE FROM users WHERE id=$1', [owner]);
    await db.end();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
