// End-to-end check of the GitHub and Google Drive connectors: the real OAuth flow and API code
// against local fake providers (no real accounts), on a temporary second app server (port 3003).
// The fake Google verifies PKCE like the real one. Refuses to run if a real connection exists.
// Usage: node scripts/check-connectors.cjs
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { createHash, randomBytes } = require('node:crypto');
require('@next/env').loadEnvConfig(process.cwd());
const { Client } = require('pg');

const PORT = 3003, BASE = `http://localhost:${PORT}`;
const started = new Date();
const TOKENS = { gh: `gho_${randomBytes(12).toString('hex')}`, ghRefresh: `ghr_${randomBytes(12).toString('hex')}`, g1: `ya29.first${randomBytes(8).toString('hex')}`, g2: `ya29.second${randomBytes(8).toString('hex')}`, gRefresh: `1//r${randomBytes(8).toString('hex')}` };
const seen = { pkceOk: false, refreshed: false, ghRevoked: false, gRevoked: false, nonGet: [] };
const pending = {}; // code -> { challenge, redirect }

const send = (res, status, body, type = 'application/json') => { res.writeHead(status, { 'content-type': type }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
const readBody = req => new Promise(r => { let b = ''; req.on('data', c => (b += c)); req.on('end', () => r(b)); });
const authed = (req, token) => req.headers.authorization === `Bearer ${token}`;

const fake = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://fake');
  const body = await readBody(req);
  const isApi = url.pathname.startsWith('/gh-api') || url.pathname.startsWith('/g-api');
  if (isApi && req.method !== 'GET' && !url.pathname.includes('/applications/')) seen.nonGet.push(`${req.method} ${url.pathname}`);
  // GitHub OAuth
  if (url.pathname === '/gh/login/oauth/authorize') {
    const code = randomBytes(6).toString('hex'); pending[code] = { redirect: url.searchParams.get('redirect_uri') };
    res.writeHead(302, { location: `${url.searchParams.get('redirect_uri')}?code=${code}&state=${encodeURIComponent(url.searchParams.get('state'))}` }); return res.end();
  }
  if (url.pathname === '/gh/login/oauth/access_token') {
    const p = new URLSearchParams(body);
    if (p.get('client_secret') !== 'gh-secret' || !pending[p.get('code')]) return send(res, 200, { error: 'bad_verification_code' });
    delete pending[p.get('code')];
    return send(res, 200, { access_token: TOKENS.gh, scope: 'read:user,repo', token_type: 'bearer' });
  }
  if (url.pathname === '/gh-api/user') return authed(req, TOKENS.gh) ? send(res, 200, { id: 42, login: 'octo-tester' }) : send(res, 401, {});
  if (url.pathname === '/gh-api/user/repos') return authed(req, TOKENS.gh) ? send(res, 200, [{ full_name: 'octo-tester/demo', private: true, default_branch: 'main', description: 'Demo repo', updated_at: '2026-10-01T00:00:00Z' }]) : send(res, 401, {});
  if (url.pathname === '/gh-api/repos/octo-tester/demo/git/trees/main') return send(res, 200, { truncated: false, tree: [{ path: 'README.md', type: 'blob', size: 12 }, { path: 'src', type: 'tree' }, { path: 'src/app.ts', type: 'blob', size: 20 }] });
  if (url.pathname === '/gh-api/repos/octo-tester/demo/contents/src/app.ts') return send(res, 200, { type: 'file', path: 'src/app.ts', size: 20, sha: 'abc', encoding: 'base64', content: Buffer.from('export const x = 1;\n').toString('base64') });
  if (url.pathname.startsWith('/gh-api/applications/gh-id/grant') && req.method === 'DELETE') { seen.ghRevoked = JSON.parse(body || '{}').access_token === TOKENS.gh; res.writeHead(204); return res.end(); }
  // Google OAuth (PKCE verified)
  if (url.pathname === '/g/o/oauth2/v2/auth') {
    const code = randomBytes(6).toString('hex'); pending[code] = { challenge: url.searchParams.get('code_challenge'), method: url.searchParams.get('code_challenge_method') };
    res.writeHead(302, { location: `${url.searchParams.get('redirect_uri')}?code=${code}&state=${encodeURIComponent(url.searchParams.get('state'))}` }); return res.end();
  }
  if (url.pathname === '/g/token') {
    const p = new URLSearchParams(body);
    if (p.get('grant_type') === 'refresh_token') {
      if (p.get('refresh_token') !== TOKENS.gRefresh) return send(res, 400, { error: 'invalid_grant' });
      seen.refreshed = true;
      return send(res, 200, { access_token: TOKENS.g2, expires_in: 3600, scope: 'openid email https://www.googleapis.com/auth/drive.readonly' });
    }
    const pend = pending[p.get('code')];
    const expected = pend && createHash('sha256').update(p.get('code_verifier') || '').digest('base64url');
    if (!pend || pend.method !== 'S256' || expected !== pend.challenge) return send(res, 400, { error: 'invalid_grant', error_description: 'PKCE verification failed' });
    seen.pkceOk = true; delete pending[p.get('code')];
    return send(res, 200, { access_token: TOKENS.g1, refresh_token: TOKENS.gRefresh, expires_in: 1, scope: 'openid email https://www.googleapis.com/auth/drive.readonly' });
  }
  if (url.pathname === '/g/revoke') { seen.gRevoked = new URLSearchParams(body).get('token') === TOKENS.gRefresh; return send(res, 200, {}); }
  if (url.pathname === '/g/userinfo') return (authed(req, TOKENS.g1) || authed(req, TOKENS.g2)) ? send(res, 200, { sub: '1001', email: 'tester@example.com' }) : send(res, 401, {});
  if (url.pathname === '/g-api/drive/v3/files') return authed(req, TOKENS.g2) ? send(res, 200, { files: [{ id: 'doc_123456', name: 'Roadmap', mimeType: 'application/vnd.google-apps.document', modifiedTime: '2026-10-02T00:00:00Z' }] }) : send(res, 401, {});
  if (url.pathname === '/g-api/drive/v3/files/doc_123456') return send(res, 200, { id: 'doc_123456', name: 'Roadmap', mimeType: 'application/vnd.google-apps.document' });
  if (url.pathname === '/g-api/drive/v3/files/doc_123456/export') return send(res, 200, 'Q1: connectors. Q2: code agent.', 'text/plain');
  send(res, 404, { error: 'not found' });
});

async function waitFor(url) {
  for (let i = 0; i < 90; i++) { try { if ((await fetch(url)).status < 500) return; } catch {} await new Promise(r => setTimeout(r, 1000)); }
  throw new Error('server did not start');
}
const call = async (path, method = 'GET', headers = {}) => {
  const r = await fetch(BASE + path, { method, redirect: 'manual', headers: { origin: BASE, ...headers } });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, location: r.headers.get('location') };
};
/** Simulates the user approving on the provider page: follow the consent URL to our callback. */
async function consent(url) {
  const toCallback = (await fetch(url, { redirect: 'manual' })).headers.get('location');
  const r = await fetch(toCallback, { redirect: 'manual' });
  return { callback: toCallback, location: r.headers.get('location') };
}

(async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const owner = (await db.query('SELECT id FROM users WHERE is_local LIMIT 1')).rows[0]?.id;
  const existing = (await db.query('SELECT count(*)::int AS n FROM connector_accounts WHERE owner_id = $1', [owner])).rows[0].n;
  if (existing) { console.log('SKIP: this account has real connector connections; not touching them.'); await db.end(); return; }
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  const F = `http://127.0.0.1:${fake.address().port}`;
  const env = {
    ...process.env, APP_ORIGIN: BASE, CONNECTOR_TOKEN_KEY: randomBytes(32).toString('base64'),
    GITHUB_CLIENT_ID: 'gh-id', GITHUB_CLIENT_SECRET: 'gh-secret', GITHUB_OAUTH_URL: `${F}/gh`, GITHUB_API_URL: `${F}/gh-api`,
    GOOGLE_CLIENT_ID: 'g-id', GOOGLE_CLIENT_SECRET: 'g-secret', GOOGLE_OAUTH_URL: `${F}/g`, GOOGLE_TOKEN_URL: `${F}/g/token`,
    GOOGLE_REVOKE_URL: `${F}/g/revoke`, GOOGLE_USERINFO_URL: `${F}/g/userinfo`, GOOGLE_API_URL: `${F}/g-api`,
  };
  const server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '--hostname', 'localhost', '--port', String(PORT)], { env, stdio: 'ignore' });
  const responses = [];
  const track = r => { responses.push(r.text); return r; };
  try {
    await waitFor(BASE + '/');
    const first = track(await call('/api/connectors'));
    assert.equal(first.status, 200, `GET /api/connectors: ${first.status} ${first.text.slice(0, 300)}`);
    let status = first.json.data;
    assert.deepEqual(status.map(s => [s.id, s.configured, s.keyConfigured, s.connected]), [['github', true, true, false], ['google_drive', true, true, false]]);
    assert.equal((await call('/api/connectors', 'GET', { 'x-forwarded-for': '203.0.113.9' })).status, 401);
    assert.equal((await call('/api/connectors/github/connect', 'POST', { origin: 'https://evil.example' })).status, 403);
    assert.equal(track(await call('/api/connectors/github/repos')).json.error, 'NOT_CONNECTED');
    console.log('PASS status, local-account only, same-origin, not connected');

    // GitHub: connect, then browse.
    const ghStart = track(await call('/api/connectors/github/connect', 'POST')).json.data.url;
    const ghState = new URL(ghStart).searchParams.get('state');
    assert.ok(ghStart.startsWith(`${F}/gh/login/oauth/authorize`) && ghState.length >= 40);
    const gh = await consent(ghStart);
    assert.match(gh.location, /\/connectors\?connected=github$/);
    const replay = await fetch(gh.callback, { redirect: 'manual' });
    assert.match(replay.headers.get('location'), /error=INVALID_STATE/);
    const forged = await fetch(`${BASE}/api/connectors/github/callback?code=x&state=forged`, { redirect: 'manual' });
    assert.match(forged.headers.get('location'), /error=INVALID_STATE/);
    const row = (await db.query("SELECT * FROM connector_accounts WHERE owner_id = $1 AND provider = 'github'", [owner])).rows[0];
    assert.equal(row.external_login, 'octo-tester');
    assert.ok(row.access_token_enc.startsWith('v1.') && !row.access_token_enc.includes(TOKENS.gh), 'token stored encrypted');
    const repos = track(await call('/api/connectors/github/repos')).json.data;
    assert.deepEqual(repos.map(r => r.fullName), ['octo-tester/demo']);
    const tree = track(await call('/api/connectors/github/repos/octo-tester/demo/tree?ref=main')).json.data;
    assert.deepEqual(tree.files.map(f => f.path), ['README.md', 'src/app.ts']);
    const file = track(await call('/api/connectors/github/repos/octo-tester/demo/file?path=src%2Fapp.ts&ref=main')).json.data;
    assert.equal(file.content, 'export const x = 1;\n');
    assert.equal((await call('/api/connectors/github/repos/octo-tester/demo/file?path=..%2Fsecret')).status, 422);
    console.log('PASS GitHub: OAuth (state single-use, forged state rejected), encrypted token, repos, tree, file, path traversal refused');

    // Google Drive: PKCE, refresh of an expired token, read a Doc.
    const gStart = track(await call('/api/connectors/google_drive/connect', 'POST')).json.data.url;
    assert.equal(new URL(gStart).searchParams.get('code_challenge_method'), 'S256');
    const g = await consent(gStart);
    assert.match(g.location, /connected=google_drive/);
    assert.ok(seen.pkceOk, 'PKCE verified by the provider');
    await new Promise(r => setTimeout(r, 1200));   // the first access token expires in 1s
    const files = track(await call('/api/connectors/google_drive/files')).json.data;
    assert.ok(seen.refreshed, 'expired token refreshed');
    assert.deepEqual(files.files.map(f => [f.name, f.readable]), [['Roadmap', true]]);
    const docText = track(await call('/api/connectors/google_drive/files/doc_123456')).json.data;
    assert.equal(docText.content, 'Q1: connectors. Q2: code agent.');
    console.log('PASS Google Drive: OAuth with PKCE, refresh of an expired token, file list, Google Doc exported as text');

    // Tokens never reach the browser; only GET requests hit provider APIs.
    for (const t of Object.values(TOKENS)) assert.ok(!responses.some(r => r && r.includes(t)), 'no token in any API response');
    assert.deepEqual(seen.nonGet, []);
    status = track(await call('/api/connectors')).json.data;
    assert.deepEqual(status.map(s => [s.connected, s.account]), [[true, 'octo-tester'], [true, 'tester@example.com']]);
    console.log('PASS no token in any response; provider APIs only received GET requests');

    // Disconnect revokes and deletes.
    assert.equal((await call('/api/connectors/github', 'DELETE')).status, 204);
    assert.equal((await call('/api/connectors/google_drive', 'DELETE')).status, 204);
    assert.ok(seen.ghRevoked && seen.gRevoked, 'grants revoked at the providers');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM connector_accounts WHERE owner_id = $1', [owner])).rows[0].n, 0);
    assert.equal((await call('/api/connectors/github/repos')).json.error, 'NOT_CONNECTED');
    const audit = (await db.query('SELECT action, outcome, detail FROM connector_audit WHERE owner_id = $1 AND created_at >= $2', [owner, started])).rows;
    for (const action of ['connect.start', 'connect.complete', 'repos.list', 'repo.file', 'token.refresh', 'file.read', 'disconnect']) assert.ok(audit.some(a => a.action === action && a.outcome === 'success'), `audited ${action}`);
    assert.ok(audit.some(a => a.action === 'connect.callback' && a.outcome === 'denied'), 'forged/replayed state audited');
    assert.ok(!JSON.stringify(audit).includes('gho_') && !JSON.stringify(audit).includes('ya29'), 'no tokens in audit');
    console.log(`PASS disconnect revokes and deletes; ${audit.length} audit events, none containing tokens`);
  } finally {
    server.kill();
    fake.close();
    await db.query('DELETE FROM connector_accounts WHERE owner_id = $1 AND created_at >= $2', [owner, started]).catch(() => {});
    await db.query('DELETE FROM connector_oauth_states WHERE owner_id = $1', [owner]).catch(() => {});
    await db.query('DELETE FROM connector_audit WHERE owner_id = $1 AND created_at >= $2', [owner, started]).catch(() => {});
    console.log('cleanup done');
    await db.end();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
