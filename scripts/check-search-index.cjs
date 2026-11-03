// End-to-end check of the A-Zee Search Index over HTTP against the real database, on a temporary
// second app server (port 3005). GitHub ingestion uses a local fake GitHub API and a seeded,
// encrypted connector token (refuses to run if this account has a real GitHub connection).
// Covers ingestion, ranking, excerpts with provenance, owner and collection isolation, updates,
// deletion, duplicates, sync from the source, malformed and oversized input. Cleans up after itself.
// Usage: node scripts/check-search-index.cjs
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { createCipheriv, randomBytes, randomUUID } = require('node:crypto');
require('@next/env').loadEnvConfig(process.cwd());
const { Client } = require('pg');

const PORT = 3005, BASE = `http://localhost:${PORT}`;
const KEY = randomBytes(32);
const MARK = /[]/g;
const seal = plain => {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', KEY, iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
};

// Fake GitHub: one mutable file, one binary file; every request must carry the seeded token.
let guide = '# Deployment guide\n\nThe zephyrine release train ships every second Thursday after the canary bake.\n';
let guideExists = true;
const ghRequests = [];
const github = http.createServer((req, res) => {
  ghRequests.push(`${req.method} ${req.url}`);
  const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.headers.authorization !== 'Bearer gho_index_check') return send(401, { message: 'Bad credentials' });
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/repos/acme/docs/contents/guides/deploy.md') {
    if (!guideExists) return send(404, { message: 'Not Found' });
    return send(200, { type: 'file', path: 'guides/deploy.md', size: guide.length, sha: 's1', encoding: 'base64', content: Buffer.from(guide).toString('base64') });
  }
  if (url.pathname === '/repos/acme/docs/contents/logo.png') return send(200, { type: 'file', path: 'logo.png', size: 4, sha: 's2', encoding: 'base64', content: Buffer.from([0x89, 0, 1, 2]).toString('base64') });
  send(404, { message: 'Not Found' });
});

async function waitFor(url) {
  for (let i = 0; i < 90; i++) { try { if ((await fetch(url)).status < 500) return; } catch {} await new Promise(r => setTimeout(r, 1000)); }
  throw new Error('server did not start');
}
const call = async (p, method = 'GET', body, headers = {}) => {
  const mutation = method !== 'GET';
  const r = await fetch(BASE + p, { method, headers: { origin: BASE, ...(mutation ? { 'x-azee-request': '1' } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
};
const expectStatus = (res, status, error, label) => {
  assert.equal(res.status, status, `${label}: ${res.status} ${res.text.slice(0, 300)}`);
  if (error) assert.equal(res.json.error, error, label);
  return res.json?.data;
};
const search = async (q, collectionId) => expectStatus(await call(`/api/v1/search/index/query?${new URLSearchParams({ q, ...(collectionId ? { collectionId } : {}) })}`), 200, null, `query ${q}`);

(async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const owner = (await db.query('SELECT id FROM users WHERE is_local LIMIT 1')).rows[0]?.id;
  assert.ok(owner, 'local account required');
  if ((await db.query(`SELECT 1 FROM connector_accounts WHERE owner_id = $1 AND provider = 'github'`, [owner])).rowCount) {
    throw new Error('This account has a real GitHub connection; the check would replace it. Disconnect it first or skip this check.');
  }
  const other = `check-${randomUUID()}`;
  await db.query('INSERT INTO users (id, email, name) VALUES ($1, $2, $3)', [other, `${other}@example.invalid`, 'Index check']);
  await new Promise(r => github.listen(0, '127.0.0.1', r));
  const env = { ...process.env, APP_ORIGIN: BASE, CONNECTOR_TOKEN_KEY: KEY.toString('base64'), GITHUB_CLIENT_ID: 'fake-id', GITHUB_CLIENT_SECRET: 'fake-secret', GITHUB_API_URL: `http://127.0.0.1:${github.address().port}` };
  const server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '--hostname', 'localhost', '--port', String(PORT)], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  let serverErr = '';
  server.stderr.on('data', d => { serverErr = (serverErr + d).slice(-4000); });
  const created = [];
  try {
    await waitFor(BASE + '/');
    const st = expectStatus(await call('/api/v1/search/index'), 200, null, 'status');
    assert.equal(st.engine, 'postgresql_fts');
    assert.equal(st.vectorSearch.readiness, 'infrastructure_blocked');
    assert.equal(st.vectorSearch.extensionAvailable, false);

    // Collections (workspaces) and refusals.
    expectStatus(await call('/api/v1/search/index/collections', 'POST', { name: 'x' }, { 'x-azee-request': '' }), 403, 'CSRF_HEADER_REQUIRED', 'csrf');
    expectStatus(await call('/api/v1/search/index/collections', 'POST', { name: 'x' }, { origin: 'https://evil.example' }), 403, 'INVALID_ORIGIN', 'origin');
    const tag = randomUUID().slice(0, 6);
    const alpha = expectStatus(await call('/api/v1/search/index/collections', 'POST', { name: `zz-alpha-${tag}` }), 201, null, 'collection alpha');
    const beta = expectStatus(await call('/api/v1/search/index/collections', 'POST', { name: `zz-beta-${tag}` }), 201, null, 'collection beta');
    created.push(alpha.id, beta.id);
    expectStatus(await call('/api/v1/search/index/collections', 'POST', { name: `ZZ-ALPHA-${tag}` }), 409, 'COLLECTION_EXISTS', 'duplicate collection name');

    // Ingestion and ranking.
    const ingest = (body, status = 201) => call('/api/v1/search/index/documents', 'POST', body).then(r => expectStatus(r, status, null, `ingest ${body.title ?? body.path}`));
    const lighthouse = await ingest({ source: 'text', collectionId: alpha.id, title: 'Lighthouse keeping', content: 'The quillfeather lighthouse on Morrow Point uses a rotating Fresnel lens. Keepers trimmed the quillfeather wicks nightly.\n\nIn 1931 the quillfeather lamp was electrified.' });
    assert.equal(lighthouse.outcome, 'created');
    assert.equal(lighthouse.document.version, 1);
    await ingest({ source: 'text', collectionId: alpha.id, title: 'Harbour notes', content: 'Boats moor near Morrow Point. A quillfeather is mentioned once in passing.' });
    const long = Array.from({ length: 30 }, (_, i) => `Section ${i}. ` + 'Ordinary filler text about tides and weather. '.repeat(12)).join('\n\n') + '\n\nFinal section: the vantablue protocol requires two signatures.';
    const longDoc = await ingest({ source: 'text', collectionId: alpha.id, title: 'Long manual', content: long });
    assert.ok(longDoc.document.chunks > 3, `long document chunked (${longDoc.document.chunks})`);
    await ingest({ source: 'text', collectionId: beta.id, title: 'Beta only', content: 'Secret beta workspace note about the quillfeather budget.' });
    // Another account's document with the same words.
    const otherCol = (await db.query(`INSERT INTO search_index_collections (owner_id, name) VALUES ($1, 'other') RETURNING id`, [other])).rows[0].id;
    const otherDoc = (await db.query(`INSERT INTO search_index_documents (owner_id, collection_id, source_type, title, content, content_hash, bytes) VALUES ($1, $2, 'text', 'Other account', 'quillfeather vantablue private', 'h', 30) RETURNING id`, [other, otherCol])).rows[0].id;
    await db.query(`INSERT INTO search_index_chunks (document_id, owner_id, collection_id, position, start_offset, end_offset, content) VALUES ($1, $2, $3, 0, 0, 30, 'quillfeather vantablue private')`, [otherDoc, other, otherCol]);

    let r = await search('quillfeather lighthouse', alpha.id);
    assert.ok(r.results.length >= 1);
    assert.equal(r.results[0].source.title, 'Lighthouse keeping', 'most relevant document ranks first');
    assert.ok(r.results.every((x, i) => i === 0 || x.rank <= r.results[i - 1].rank), 'ranked by score');
    assert.match(r.results[0].excerpt, /quillfeather/i, 'excerpt highlights the match');
    r = await search('vantablue protocol', alpha.id);
    assert.equal(r.results[0].source.title, 'Long manual');
    assert.ok(r.results[0].location.chunk > 0, 'match found in a later chunk');
    console.log(`PASS ingest text into collections; ranked results with highlighted excerpts (long document: ${longDoc.document.chunks} chunks)`);

    // Provenance: every excerpt is real text at the stated position of the stated version.
    for (const q of ['quillfeather', 'vantablue protocol', 'Morrow Point']) {
      for (const res of (await search(q)).results) {
        const doc = expectStatus(await call(`/api/v1/search/index/documents/${res.source.documentId}`), 200, null, 'document');
        const chunkText = doc.content.slice(res.location.start, res.location.end);
        assert.ok(chunkText.includes(res.excerpt.replace(MARK, '')), `excerpt is in ${doc.title} at ${res.location.start}-${res.location.end}`);
        assert.equal(res.source.contentHash, doc.contentHash);
        assert.equal(res.source.version, doc.version);
      }
    }
    console.log('PASS provenance: every excerpt is found in its document at the stated offsets; hash and version match');

    // Isolation.
    const all = await search('quillfeather');
    assert.ok(all.results.some(x => x.source.title === 'Beta only'), 'all-collections search includes beta');
    assert.ok(!all.results.some(x => x.source.documentId === otherDoc), "another account's document never appears");
    assert.ok(!(await search('quillfeather', alpha.id)).results.some(x => x.source.title === 'Beta only'), 'collection filter prevents cross-workspace results');
    expectStatus(await call(`/api/v1/search/index/query?q=quillfeather&collectionId=${otherCol}`), 404, 'COLLECTION_NOT_FOUND', 'foreign collection query');
    expectStatus(await call(`/api/v1/search/index/documents/${otherDoc}`), 404, 'DOCUMENT_NOT_FOUND', 'foreign document read');
    expectStatus(await call(`/api/v1/search/index/documents/${otherDoc}`, 'DELETE'), 404, 'DOCUMENT_NOT_FOUND', 'foreign document delete');
    expectStatus(await call('/api/v1/search/index/documents', 'POST', { source: 'text', collectionId: otherCol, title: 'x', content: 'y' }), 404, 'COLLECTION_NOT_FOUND', 'ingest into foreign collection');
    // A caller that isn't this machine (any non-loopback hop) gets nothing.
    const remote = { 'x-forwarded-for': '203.0.113.9' };
    expectStatus(await call('/api/v1/search/index/query?q=quillfeather', 'GET', undefined, remote), 401, 'SIGN_IN_REQUIRED', 'remote query');
    expectStatus(await call(`/api/v1/search/index/documents/${lighthouse.document.id}`, 'GET', undefined, remote), 401, 'SIGN_IN_REQUIRED', 'remote document read');
    expectStatus(await call('/api/v1/search/index/collections', 'GET', undefined, remote), 401, 'SIGN_IN_REQUIRED', 'remote collections');
    expectStatus(await call('/api/v1/search/index/documents', 'POST', { source: 'text', collectionId: alpha.id, title: 'x', content: 'y' }, remote), 401, 'SIGN_IN_REQUIRED', 'remote ingest');
    console.log("PASS access: non-local callers get 401; other account's documents and collections invisible (404); collection filter holds");

    // Updates replace stale content.
    const upd = expectStatus(await call(`/api/v1/search/index/documents/${lighthouse.document.id}`, 'PUT', { content: 'The lighthouse now uses an LED beacon called the starglint array.' }), 200, null, 'update');
    assert.equal(upd.outcome, 'updated');
    assert.equal(upd.document.version, 2);
    assert.ok(!(await search('Fresnel', alpha.id)).results.some(x => x.source.documentId === lighthouse.document.id), 'old text no longer matches');
    assert.equal((await search('starglint', alpha.id)).results[0]?.source.version, 2);
    assert.equal(expectStatus(await call(`/api/v1/search/index/documents/${lighthouse.document.id}`, 'PUT', { content: 'The lighthouse now uses an LED beacon called the starglint array.' }), 200, null, 'same update').outcome, 'unchanged');
    console.log('PASS updates: new version indexed, stale text gone, identical update is a no-op');

    // Duplicates.
    const dup = await ingest({ source: 'text', collectionId: alpha.id, title: 'Copy', content: 'Boats moor near Morrow Point. A quillfeather is mentioned once in passing.\r\n' }, 200);
    assert.equal(dup.outcome, 'duplicate');
    const concurrent = await Promise.all([1, 2, 3].map(() => call('/api/v1/search/index/documents', 'POST', { source: 'text', collectionId: beta.id, title: 'Race', content: 'Concurrent ingest of the same text: glimmerwick.' })));
    assert.deepEqual(concurrent.map(c => c.json.data.outcome).sort(), ['created', 'duplicate', 'duplicate']);
    assert.equal((await search('glimmerwick', beta.id)).results.length, 1);
    console.log('PASS duplicates: identical text (even with CRLF) and concurrent ingests stored once');

    // Malformed and oversized input.
    expectStatus(await call('/api/v1/search/index/query?q='), 422, 'INVALID_INPUT', 'empty query');
    expectStatus(await call(`/api/v1/search/index/query?q=${'a'.repeat(301)}`), 422, 'INVALID_INPUT', 'long query');
    for (const q of ['"unterminated', 'a & | ! (', '-', 'OR OR', "'; DROP TABLE users; --"]) expectStatus(await call(`/api/v1/search/index/query?${new URLSearchParams({ q })}`), 200, null, `odd query ${q}`);
    assert.equal((await search('the and of')).note, 'NO_SEARCHABLE_TERMS');
    expectStatus(await call('/api/v1/search/index/query?q=x&collectionId=not-a-uuid'), 422, 'INVALID_INPUT', 'bad collection id');
    expectStatus(await call('/api/v1/search/index/documents', 'POST', { source: 'text', collectionId: alpha.id, title: 'Big', content: 'x'.repeat(1_000_001) }), 413, 'DOCUMENT_TOO_LARGE', 'oversized document');
    expectStatus(await call('/api/v1/search/index/documents', 'POST', { source: 'text', collectionId: alpha.id, title: 'Huge', content: 'x'.repeat(1_200_000) }), 413, 'BODY_TOO_LARGE', 'oversized body');
    expectStatus(await call('/api/v1/search/index/documents', 'POST', { source: 'text', collectionId: alpha.id, title: 'Blank', content: ' \n ' }), 422, 'EMPTY_DOCUMENT', 'empty document');
    expectStatus(await call('/api/v1/search/index/documents', 'POST', '{not json'), 422, 'INVALID_JSON', 'malformed json');
    expectStatus(await call('/api/v1/search/index/documents', 'POST', { source: 'ftp', collectionId: alpha.id }), 422, 'INVALID_INPUT', 'unknown source');
    expectStatus(await call('/api/v1/search/index/documents', 'POST', { source: 'github', collectionId: alpha.id, repo: 'acme/docs', path: '../secrets' }), 422, 'INVALID_INPUT', 'path traversal');
    console.log('PASS malformed queries handled safely (no errors, no SQL injection); oversized, empty and malformed documents refused');

    // GitHub: not connected → explicit error; then explicit one-file ingestion and sync.
    expectStatus(await call('/api/v1/search/index/documents', 'POST', { source: 'github', collectionId: alpha.id, repo: 'acme/docs', path: 'guides/deploy.md' }), 409, 'NOT_CONNECTED', 'github not connected');
    await db.query(`INSERT INTO connector_accounts (owner_id, provider, external_id, external_login, scopes, access_token_enc) VALUES ($1, 'github', '1', 'index-check', '{repo}', $2)`, [owner, seal('gho_index_check')]);
    const gh = await ingest({ source: 'github', collectionId: alpha.id, repo: 'acme/docs', path: 'guides/deploy.md', ref: 'main' });
    assert.equal(gh.document.sourceType, 'github');
    assert.equal(gh.document.url, 'https://github.com/acme/docs/blob/main/guides/deploy.md');
    assert.equal((await search('zephyrine release', alpha.id)).results[0]?.source.url, gh.document.url);
    assert.equal((await ingest({ source: 'github', collectionId: alpha.id, repo: 'acme/docs', path: 'guides/deploy.md', ref: 'main' }, 200)).outcome, 'unchanged', 're-adding the same source does not duplicate');
    expectStatus(await call('/api/v1/search/index/documents', 'POST', { source: 'github', collectionId: alpha.id, repo: 'acme/docs', path: 'logo.png' }), 415, 'BINARY_FILE', 'binary file');
    assert.equal(expectStatus(await call(`/api/v1/search/index/documents/${gh.document.id}/sync`, 'POST'), 200, null, 'sync unchanged').outcome, 'unchanged');
    guide = '# Deployment guide\n\nReleases now ship weekly through the halcyon pipeline.\n';
    const synced = expectStatus(await call(`/api/v1/search/index/documents/${gh.document.id}/sync`, 'POST'), 200, null, 'sync changed');
    assert.equal(synced.outcome, 'updated');
    assert.equal(synced.document.version, 2);
    assert.equal((await search('zephyrine', alpha.id)).results.length, 0, 'stale source text removed after sync');
    assert.equal((await search('halcyon pipeline', alpha.id)).results[0]?.source.version, 2);
    guideExists = false;
    expectStatus(await call(`/api/v1/search/index/documents/${gh.document.id}/sync`, 'POST'), 404, 'SOURCE_NOT_FOUND', 'sync deleted source');
    expectStatus(await call(`/api/v1/search/index/documents/${lighthouse.document.id}/sync`, 'POST'), 409, 'NOT_A_CONNECTOR_DOCUMENT', 'sync text document');
    assert.ok(ghRequests.every(x => x.startsWith('GET ')), 'GitHub only received GET requests');
    console.log(`PASS GitHub: one selected file indexed with its URL; re-add is a no-op; binary refused; sync replaces changed content; ${ghRequests.length} read-only requests`);

    // Deletion.
    expectStatus(await call(`/api/v1/search/index/documents/${gh.document.id}`, 'DELETE'), 204, null, 'delete document');
    assert.equal((await search('halcyon', alpha.id)).results.length, 0, 'deleted document disappears');
    expectStatus(await call(`/api/v1/search/index/documents/${gh.document.id}`), 404, 'DOCUMENT_NOT_FOUND', 'deleted document');
    expectStatus(await call(`/api/v1/search/index/collections/${beta.id}`, 'DELETE'), 204, null, 'delete collection');
    assert.equal((await search('glimmerwick')).results.length, 0, 'documents of a deleted collection disappear');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM search_index_chunks WHERE collection_id = $1', [beta.id])).rows[0].n, 0, 'no orphan chunks');
    console.log('PASS deletion: deleted documents and collections disappear from results; no orphan chunks');
  } catch (error) {
    if (serverErr) console.error(`server stderr:\n${serverErr}`);
    throw error;
  } finally {
    server.kill();
    github.close();
    await db.query(`DELETE FROM connector_accounts WHERE owner_id = $1 AND provider = 'github' AND external_login = 'index-check'`, [owner]);
    await db.query(`DELETE FROM connector_audit WHERE owner_id = $1 AND action = 'index.file'`, [owner]);
    await db.query('DELETE FROM search_index_collections WHERE id = ANY($1::uuid[])', [created]);
    await db.query('DELETE FROM users WHERE id = $1', [other]);
    const left = (await db.query('SELECT count(*)::int AS n FROM search_index_collections WHERE id = ANY($1::uuid[])', [created])).rows[0].n;
    await db.end();
    console.log(`cleanup: ${left} leftover collections`);
  }
})().catch(error => { console.error(error); process.exit(1); });
