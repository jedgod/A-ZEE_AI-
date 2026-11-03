// End-to-end check of A-Zee Search and Deep Research against the real database and real AI
// providers, with a local fake Tavily (no search key needed) on a temporary second app server
// (port 3002). Also kills that server mid-research to prove a job resumes from its checkpoint.
// Restores this account's plan usage counters and deletes everything it created.
// Usage: node scripts/check-search.cjs   (main server on :3000 for the "not configured" check)
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
require('@next/env').loadEnvConfig(process.cwd());
const { Client } = require('pg');

const PORT = 3002, BASE = `http://localhost:${PORT}`;
const tag = `zzcheck${randomUUID().slice(0, 6)}`;
const started = new Date();

// Fake Tavily: deterministic pages about a fictional topic (so answers must come from sources).
const PAGES = [
  { url: `https://example.org/${tag}/glowfern`, title: 'The glowfern of Vellmar', published_date: '2026-09-14',
    content: 'The glowfern is a bioluminescent plant found only in the Vellmar caves. It emits a pale green light at night and grows about forty centimetres tall. Researchers first described the glowfern in 2019.' },
  { url: `https://example.org/${tag}/caves`, title: 'Vellmar cave survey', published_date: '2025-02-01',
    content: 'A 2024 survey counted roughly 3,000 glowfern plants in the Vellmar caves. Cave temperatures stay near 11 degrees Celsius all year, which the survey links to the plant\'s slow growth.' },
  { url: `https://example.org/${tag}/debate`, title: 'Is the glowfern endangered?', published_date: '2026-06-30',
    content: 'Some ecologists argue the glowfern is endangered because it grows in a single cave system. Others say the population of about 3,000 plants is stable and does not need protected status.' },
];
const seenAuth = new Set();
const tavily = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => (body += c));
  req.on('end', () => {
    seenAuth.add(req.headers.authorization);
    const n = JSON.parse(body || '{}').max_results || 5;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ results: PAGES.slice(0, n).map((p, i) => ({ ...p, score: 0.9 - i * 0.1 })) }));
  });
});

async function waitFor(url) {
  for (let i = 0; i < 90; i++) {
    try { if ((await fetch(url)).status < 500) return; } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error(`server did not start: ${url}`);
}
const call = async (base, path, method = 'GET', body, headers = {}) => {
  const r = await fetch(base + path, { method, headers: { origin: base, ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, headers: r.headers };
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const owner = (await db.query('SELECT id FROM users WHERE is_local LIMIT 1')).rows[0]?.id;
  assert.ok(owner, 'local account required');
  const usage = (await db.query('SELECT * FROM usage_counters WHERE subject = $1', [`account:${owner}`])).rows;
  const other = `check-${randomUUID()}`;
  await new Promise(r => tavily.listen(0, '127.0.0.1', r));
  const env = { ...process.env, TAVILY_API_KEY: 'tvly-fake-check', TAVILY_BASE_URL: `http://127.0.0.1:${tavily.address().port}`, APP_ORIGIN: BASE };
  const start = () => spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '--hostname', 'localhost', '--port', String(PORT)], { env, stdio: 'ignore' });
  let server = start();
  try {
    // Without a key (main server): a clear setup error.
    const off = await call('http://localhost:3000', '/api/v1/search/query', 'POST', { query: 'anything' });
    if (off.status !== 0) {
      assert.equal(off.status, 503, `not-configured status ${off.status}`);
      assert.equal(off.json.error, 'SEARCH_NOT_CONFIGURED');
      assert.match(off.json.setup, /TAVILY_API_KEY/);
      console.log('PASS without TAVILY_API_KEY: 503 SEARCH_NOT_CONFIGURED with setup instructions');
    }

    await waitFor(BASE + '/api/v1/search/status');
    assert.deepEqual((await call(BASE, '/api/v1/search/status')).json.data, { configured: true, provider: 'tavily' });
    assert.equal((await call(BASE, '/api/v1/search/query', 'POST', { query: 'x' }, { 'x-forwarded-for': '203.0.113.9' })).status, 401);
    assert.equal((await call(BASE, '/api/v1/search/query', 'POST', { query: 'glowfern' }, { origin: 'https://evil.example' })).status, 403);
    console.log('PASS status, local-account only, same-origin');

    // Smart Search: cited answer, verified claims, provenance stored.
    const q = await call(BASE, '/api/v1/search/query', 'POST', { query: `What is the glowfern and where does it grow? ${tag}` });
    assert.equal(q.status, 200, `query: ${q.status} ${q.text.slice(0, 200)}`);
    const r = q.json.data;
    assert.ok(r.answer.length > 20 && /\[\d\]/.test(r.answer), `answer cites sources: ${JSON.stringify({ answer: r.answer, claims: r.claims, model: r.model }).slice(0, 900)}`);
    assert.equal(r.sources.length, 3);
    assert.ok(r.sources.every(s => s.url.startsWith('https://example.org/') && s.publishedAt && s.freshness.label !== 'unknown'));
    assert.ok(r.claims.length >= 1 && r.verification.total === r.claims.length);
    assert.ok(r.verification.verified >= 1, `at least one claim verified (got ${JSON.stringify(r.verification)})`);
    assert.ok(seenAuth.has('Bearer tvly-fake-check'), 'key sent only as the provider bearer');
    const stored = (await db.query('SELECT * FROM search_answers WHERE id = $1', [r.id])).rows[0];
    assert.ok(stored && stored.owner_id === owner && stored.model && stored.provider === 'tavily' && stored.source_ids.length === 3 && stored.retrieved_at);
    const src = await call(BASE, `/api/v1/search/sources/${r.sources[0].id}`);
    assert.match(src.json.data.excerpt, /glowfern/);
    console.log(`PASS smart search: ${r.verification.verified}/${r.verification.total} claims verified, provenance recorded (model ${r.model})`);

    // Verify claims.
    const v = await call(BASE, '/api/v1/search/verify-claims', 'POST', { claims: ['The glowfern grows about forty centimetres tall.'] });
    assert.equal(v.status, 200, `verify: ${v.status} ${v.text.slice(0, 200)}`);
    assert.ok(['supported', 'contradicted', 'not_found', 'unverified'].includes(v.json.data.results[0].verdict));
    console.log(`PASS verify-claims: verdict ${v.json.data.results[0].verdict}`);

    // Deep research: one active job; cancel; then a full job interrupted by a server restart.
    const c = await call(BASE, '/api/v1/search/deep-research', 'POST', { question: `Is the glowfern endangered? ${tag}` });
    assert.equal(c.status, 202, `deep research: ${c.status} ${c.text.slice(0, 200)}`);
    assert.equal((await call(BASE, '/api/v1/search/deep-research', 'POST', { question: 'second job' })).status, 409);
    const cancelled = await call(BASE, `/api/v1/research/jobs/${c.json.data.id}`, 'DELETE');
    assert.equal(cancelled.json.data.status, 'cancelled');
    console.log('PASS deep research: one active job per account; cancel');

    const job = (await call(BASE, '/api/v1/search/deep-research', 'POST', { question: `What do we know about the glowfern's population and habitat? ${tag}` })).json.data;
    let state;
    for (let i = 0; i < 120; i++) {
      state = (await call(BASE, `/api/v1/research/jobs/${job.id}`)).json.data;
      if (state.steps.length >= 1 || state.status !== 'running') break;
      await sleep(1000);
    }
    assert.equal(state.status, 'running', `job state before restart: ${JSON.stringify(state).slice(0, 300)}`);
    server.kill();
    await sleep(1500);
    await db.query("UPDATE research_jobs SET updated_at = now() - interval '5 minutes' WHERE id = $1", [job.id]);
    const checkpoint = state.steps.length;
    server = start();
    await waitFor(BASE + '/api/v1/search/status');
    for (let i = 0; i < 240; i++) {
      state = (await call(BASE, `/api/v1/research/jobs/${job.id}`)).json.data;
      if (state.status !== 'running') break;
      await sleep(1000);
    }
    assert.equal(state.status, 'completed', `job after restart: ${JSON.stringify(state).slice(0, 400)}`);
    assert.ok(state.steps.length >= checkpoint && state.steps.length === state.plan.length);
    const report = (await call(BASE, `/api/v1/research/jobs/${job.id}/report`)).json.data;
    assert.ok(report.summary.length > 50 && report.references.length >= 1 && report.references.every(x => x.url.startsWith('https://example.org/')));
    assert.ok(report.evidence.length >= 1 && report.verification.total === report.evidence.length);
    const md = await call(BASE, `/api/v1/research/jobs/${job.id}/report?format=md`);
    assert.match(md.headers.get('content-type'), /text\/markdown/);
    assert.match(md.text, /## References/);
    console.log(`PASS deep research resumed after a server restart at step ${checkpoint}/${state.plan.length}; report: ${report.verification.verified}/${report.verification.total} findings verified, ${report.references.length} references, Markdown export`);

    // Another account's data is invisible.
    await db.query("INSERT INTO users (id, email, name, is_local) VALUES ($1, $2, 'Check other', false)", [other, `${other}@example.invalid`]);
    const foreignJob = (await db.query("INSERT INTO research_jobs (owner_id, question, status) VALUES ($1, 'other question', 'completed') RETURNING id", [other])).rows[0].id;
    const foreignSource = (await db.query("INSERT INTO search_sources (owner_id, url, domain, title, excerpt, provider) VALUES ($1, 'https://example.org/x', 'example.org', 'x', 'x', 'tavily') RETURNING id", [other])).rows[0].id;
    assert.equal((await call(BASE, `/api/v1/research/jobs/${foreignJob}`)).status, 404);
    assert.equal((await call(BASE, `/api/v1/research/jobs/${foreignJob}/report`)).status, 404);
    assert.equal((await call(BASE, `/api/v1/search/sources/${foreignSource}`)).status, 404);
    assert.ok(!(await call(BASE, '/api/v1/research/jobs')).json.data.some(j => j.id === foreignJob));
    console.log("PASS another account's jobs and sources are invisible");
  } finally {
    server.kill();
    tavily.close();
    await db.query("DELETE FROM search_answers WHERE owner_id = $1 AND created_at >= $2", [owner, started]).catch(() => {});
    await db.query("DELETE FROM research_jobs WHERE owner_id = $1 AND created_at >= $2", [owner, started]).catch(() => {});
    await db.query("DELETE FROM search_sources WHERE owner_id = $1 AND url LIKE $2", [owner, `https://example.org/${tag}/%`]).catch(() => {});
    await db.query('DELETE FROM users WHERE id = $1', [other]).catch(() => {});
    await db.query('DELETE FROM usage_counters WHERE subject = $1', [`account:${owner}`]);
    for (const u of usage) await db.query('INSERT INTO usage_counters (subject, feature, period_start, used) VALUES ($1, $2, $3, $4)', [u.subject, u.feature, u.period_start, u.used]);
    const left = (await db.query("SELECT (SELECT count(*) FROM research_jobs WHERE owner_id = $1 AND created_at >= $2)::int + (SELECT count(*) FROM search_sources WHERE url LIKE $3)::int AS n", [owner, started, `https://example.org/${tag}/%`])).rows[0].n;
    console.log(`cleanup: ${left} leftover rows; usage counters restored (${usage.length} rows)`);
    await db.end();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
