// End-to-end check of the AI Code Agent over HTTP against the real database and real AI providers,
// on a temporary second app server (port 3004) whose workspace is a throwaway git repository.
// Covers authorization and refusals, approval gating, stale-patch detection, apply, rollback
// conflicts, rollback that preserves unrelated edits, ownership and audit. Restores this account's
// plan usage counters and deletes everything it created.
// Usage: node scripts/check-code-agent.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
require('@next/env').loadEnvConfig(process.cwd());
const { Client } = require('pg');

const PORT = 3004, BASE = `http://localhost:${PORT}`;
const started = new Date();
const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'azee-agent-check-'));
const repo = path.join(ws, 'demo');
const GREET = "export function greet(name) {\n  return 'Hello, ' + name;\n}\n";
const file = p => path.join(repo, p);
const read = p => (fs.existsSync(file(p)) ? fs.readFileSync(file(p), 'utf8') : null);

fs.mkdirSync(repo);
fs.writeFileSync(file('greet.js'), GREET);
fs.writeFileSync(file('README.md'), '# Demo\n\nA tiny module with a greet() function in greet.js.\n');
fs.writeFileSync(file('notes.txt'), 'user notes\n');
fs.writeFileSync(file('.env'), 'API_TOKEN=not-for-the-agent\n');
const git = (...args) => execFileSync('git', ['-c', 'user.name=check', '-c', 'user.email=check@example.invalid', '-C', repo, ...args], { stdio: 'pipe' });
git('init', '-q', '-b', 'main'); git('add', 'greet.js', 'README.md', 'notes.txt'); git('commit', '-q', '-m', 'init');

async function waitFor(url) {
  for (let i = 0; i < 90; i++) { try { if ((await fetch(url)).status < 500) return; } catch {} await new Promise(r => setTimeout(r, 1000)); }
  throw new Error('server did not start');
}
const call = async (p, method = 'GET', body, headers = {}) => {
  const mutation = method !== 'GET';
  const r = await fetch(BASE + p, { method, headers: { origin: BASE, ...(mutation ? { 'x-azee-request': '1', 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
};
const expectStatus = (res, status, error, label) => {
  assert.equal(res.status, status, `${label}: ${res.status} ${res.text.slice(0, 300)}`);
  if (error) assert.equal(res.json.error, error, label);
};

(async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const owner = (await db.query('SELECT id FROM users WHERE is_local LIMIT 1')).rows[0]?.id;
  assert.ok(owner, 'local account required');
  // A second account owning a task, created for this check.
  const otherUser = `check-${randomUUID()}`;
  await db.query('INSERT INTO users (id, email, name) VALUES ($1, $2, $3)', [otherUser, `${otherUser}@example.invalid`, 'Code agent check']);
  const usage = (await db.query('SELECT * FROM usage_counters WHERE subject = $1', [`account:${owner}`])).rows;
  const env = { ...process.env, APP_ORIGIN: BASE, CODE_AGENT_WORKSPACE_ROOT: ws, CODE_AGENT_REPOS: 'demo,missing' };
  const server = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '--hostname', 'localhost', '--port', String(PORT)], { env, stdio: 'ignore' });
  let foreignTask = null;
  try {
    await waitFor(BASE + '/');
    const st = await call('/api/code-agent');
    expectStatus(st, 200, null, 'status');
    assert.deepEqual(st.json.data.repos, ['demo', 'missing']);
    assert.equal(st.json.data.execution.readiness, 'infrastructure_blocked');
    assert.equal(st.json.data.execution.enabled, false);
    assert.ok(!st.text.includes(ws), 'workspace path is not disclosed');

    // Inspection and refusals.
    const treeRes = await call('/api/code-agent/repos/demo/tree');
    expectStatus(treeRes, 200, null, 'tree');
    const tree = treeRes.json.data.files.map(f => f.path);
    assert.deepEqual(tree.sort(), ['README.md', 'greet.js', 'notes.txt']);
    expectStatus(await call('/api/code-agent/repos/demo/file?path=.env'), 403, 'SENSITIVE_PATH', '.env');
    expectStatus(await call('/api/code-agent/repos/demo/file?path=.git/config'), 403, 'SENSITIVE_PATH', '.git');
    expectStatus(await call('/api/code-agent/repos/demo/file?path=' + encodeURIComponent('../../etc/passwd')), 403, 'PATH_OUTSIDE_REPO', 'traversal');
    expectStatus(await call('/api/code-agent/repos/demo/file?path=' + encodeURIComponent('C:\\Windows\\win.ini')), 403, 'PATH_OUTSIDE_REPO', 'absolute');
    expectStatus(await call('/api/code-agent/repos/other/tree'), 403, 'REPO_NOT_AUTHORIZED', 'unlisted repo');
    expectStatus(await call('/api/code-agent/repos/missing/tree'), 404, 'REPO_NOT_FOUND', 'missing repo');
    assert.equal((await call('/api/code-agent/repos/demo/file?path=greet.js')).json.data.content, GREET);
    const gitInfo = (await call('/api/code-agent/repos/demo/git')).json.data;
    assert.equal(gitInfo.branch, 'main');
    assert.deepEqual(gitInfo.changes, []);
    console.log('PASS inspection: tree, file, git status; .env/.git, traversal, absolute and unlisted repositories refused');

    // CSRF and origin.
    expectStatus(await call('/api/code-agent/tasks', 'POST', { repo: 'demo', instruction: 'x y z' }, { 'x-azee-request': '' }), 403, 'CSRF_HEADER_REQUIRED', 'no csrf header');
    expectStatus(await call('/api/code-agent/tasks', 'POST', { repo: 'demo', instruction: 'x y z' }, { origin: 'https://evil.example' }), 403, 'INVALID_ORIGIN', 'foreign origin');
    expectStatus(await call('/api/code-agent/tasks', 'POST', { repo: 'other', instruction: 'x y z' }), 403, 'REPO_NOT_AUTHORIZED', 'task on unlisted repo');
    console.log('PASS mutations need the request header and same origin; tasks only on authorized repositories');

    // Plan → generate (nothing written) → approval gates.
    const created = await call('/api/code-agent/tasks', 'POST', { repo: 'demo', instruction: "In greet.js, change the greeting from 'Hello, ' to 'Hi, '. Change nothing else." });
    expectStatus(created, 201, null, 'create');
    const id = created.json.data.id;
    const planned = await call(`/api/code-agent/tasks/${id}/plan`, 'POST');
    expectStatus(planned, 200, null, 'plan');
    assert.equal(planned.json.data.status, 'planned');
    assert.ok(planned.json.data.plan.files.some(f => f.path === 'greet.js' && f.action === 'modify'), JSON.stringify(planned.json.data.plan));
    expectStatus(await call(`/api/code-agent/tasks/${id}/apply`, 'POST', { patchHash: 'a'.repeat(64) }), 409, 'APPROVAL_REQUIRED', 'apply before approval');

    const generateOk = async () => {
      for (let attempt = 1; ; attempt++) {
        const g = await call(`/api/code-agent/tasks/${id}/generate`, 'POST');
        if (g.status === 200) return g;
        if (attempt >= 3 || ![422, 502].includes(g.status)) expectStatus(g, 200, null, 'generate');
        console.log(`  (generate attempt ${attempt}: ${g.json?.error}; retrying)`);
      }
    };
    let generated = await generateOk();
    assert.equal(generated.json.data.status, 'review');
    assert.equal(read('greet.js'), GREET, 'generating must not modify files');
    let diff = (await call(`/api/code-agent/tasks/${id}/diff`)).json.data;
    assert.ok(diff.files.some(f => f.path === 'greet.js' && /\+.*Hi, /.test(f.diff)), JSON.stringify(diff.files));
    assert.ok(!diff.files.some(f => f.path === '.env'));
    expectStatus(await call(`/api/code-agent/tasks/${id}/approve`, 'POST', { patchHash: 'b'.repeat(64) }), 409, 'PATCH_CHANGED', 'approve wrong hash');
    const ack = diff.review.some(w => w.severity === 'high');
    expectStatus(await call(`/api/code-agent/tasks/${id}/approve`, 'POST', { patchHash: diff.patchHash, acknowledgeRisks: ack }), 200, null, 'approve');
    console.log(`PASS plan → patch (${diff.totals.files} file, +${diff.totals.additions} −${diff.totals.deletions}) stored without writing; wrong-hash approval and unapproved apply refused`);

    // A file edited after approval: apply refuses, nothing overwritten, task needs regeneration.
    fs.writeFileSync(file('greet.js'), GREET + '// edited meanwhile\n');
    expectStatus(await call(`/api/code-agent/tasks/${id}/apply`, 'POST', { patchHash: diff.patchHash }), 409, 'STALE_PATCH', 'stale apply');
    assert.equal(read('greet.js'), GREET + '// edited meanwhile\n');
    assert.equal((await call(`/api/code-agent/tasks/${id}`)).json.data.status, 'stale');
    expectStatus(await call(`/api/code-agent/tasks/${id}/approve`, 'POST', { patchHash: diff.patchHash }), 409, 'INVALID_STATE', 'approve stale');
    fs.writeFileSync(file('greet.js'), GREET);
    console.log('PASS concurrent edit detected: apply refused, user content kept, regeneration required');

    generated = await generateOk();
    diff = (await call(`/api/code-agent/tasks/${id}/diff`)).json.data;
    expectStatus(await call(`/api/code-agent/tasks/${id}/approve`, 'POST', { patchHash: diff.patchHash, acknowledgeRisks: diff.review.some(w => w.severity === 'high') }), 200, null, 're-approve');
    const applied = await call(`/api/code-agent/tasks/${id}/apply`, 'POST', { patchHash: diff.patchHash });
    expectStatus(applied, 200, null, 'apply');
    assert.equal(applied.json.data.status, 'applied');
    const agentContent = read('greet.js');
    assert.match(agentContent, /Hi, /);
    expectStatus(await call(`/api/code-agent/tasks/${id}/apply`, 'POST', { patchHash: diff.patchHash }), 409, 'APPROVAL_REQUIRED', 'double apply');
    console.log('PASS approved patch applied once; second apply refused');

    // Rollback: refused while the user has edited an agent file; then preserves unrelated edits.
    fs.writeFileSync(file('greet.js'), agentContent + '// user follow-up\n');
    const conflict = await call(`/api/code-agent/tasks/${id}/rollback`, 'POST');
    expectStatus(conflict, 409, 'ROLLBACK_CONFLICT', 'rollback conflict');
    assert.deepEqual(conflict.json.detail.files, ['greet.js']);
    assert.equal(read('greet.js'), agentContent + '// user follow-up\n');
    assert.equal((await call(`/api/code-agent/tasks/${id}`)).json.data.status, 'applied');
    fs.writeFileSync(file('greet.js'), agentContent);
    fs.writeFileSync(file('notes.txt'), 'user notes\nmore user notes\n');
    expectStatus(await call(`/api/code-agent/tasks/${id}/rollback`, 'POST'), 200, null, 'rollback');
    assert.equal(read('greet.js'), GREET);
    assert.equal(read('notes.txt'), 'user notes\nmore user notes\n');
    assert.equal(read('.env'), 'API_TOKEN=not-for-the-agent\n');
    console.log('PASS rollback refused on conflict (nothing changed); then restored only the agent file, unrelated edit kept');

    // Ownership.
    expectStatus(await call(`/api/code-agent/tasks/${randomUUID()}`), 404, 'TASK_NOT_FOUND', 'unknown task');
    {
      foreignTask = (await db.query(`INSERT INTO code_agent_tasks (owner_id, repo, instruction, status) VALUES ($1, 'demo', 'foreign task', 'review') RETURNING id`, [otherUser])).rows[0].id;
      expectStatus(await call(`/api/code-agent/tasks/${foreignTask}`), 404, 'TASK_NOT_FOUND', 'foreign task read');
      expectStatus(await call(`/api/code-agent/tasks/${foreignTask}/approve`, 'POST', { patchHash: 'c'.repeat(64) }), 404, 'TASK_NOT_FOUND', 'foreign approve');
      expectStatus(await call(`/api/code-agent/tasks/${foreignTask}/rollback`, 'POST'), 404, 'TASK_NOT_FOUND', 'foreign rollback');
      assert.ok(!(await call('/api/code-agent/tasks')).json.data.some(t => t.id === foreignTask));
      console.log("PASS another account's task is invisible and can't be approved or rolled back");
    }

    // Audit.
    const auditRows = (await call(`/api/code-agent/tasks/${id}/audit`)).json.data;
    const seen = auditRows.map(a => `${a.action}:${a.outcome}`);
    for (const e of ['task.create:success', 'task.plan:success', 'task.generate:success', 'task.approve:denied', 'task.approve:success', 'task.apply:denied', 'task.apply:failure', 'task.apply:success', 'task.rollback:denied', 'task.rollback:success']) {
      assert.ok(seen.includes(e), `audit has ${e}: ${seen.join(', ')}`);
    }
    const auditText = JSON.stringify((await db.query('SELECT * FROM code_agent_audit WHERE owner_id = $1 AND created_at >= $2', [owner, started])).rows);
    assert.ok(!auditText.includes('Hello') && !auditText.includes('not-for-the-agent'), 'audit holds no file contents or secrets');
    console.log(`PASS ${auditRows.length} audit events for the task (create, plan, generate, approvals, apply, rollback), no file contents`);
  } finally {
    server.kill();
    await db.query('DELETE FROM users WHERE id = $1', [otherUser]);   // cascades to its task
    await db.query(`DELETE FROM code_agent_audit WHERE owner_id = $1 AND created_at >= $2`, [owner, started]);
    await db.query(`DELETE FROM code_agent_tasks WHERE owner_id = $1 AND repo IN ('demo', 'other') AND created_at >= $2`, [owner, started]);
    await db.query('DELETE FROM usage_counters WHERE subject = $1', [`account:${owner}`]);
    for (const u of usage) await db.query('INSERT INTO usage_counters (subject, feature, period_start, used) VALUES ($1, $2, $3, $4)', [u.subject, u.feature, u.period_start, u.used]);
    const left = (await db.query('SELECT count(*)::int AS n FROM code_agent_tasks WHERE owner_id = $1 AND created_at >= $2', [owner, started])).rows[0].n;
    await db.end();
    fs.rmSync(ws, { recursive: true, force: true });
    console.log(`cleanup: ${left} leftover tasks; usage counters restored (${usage.length} rows)`);
  }
})().catch(error => { console.error(error); process.exit(1); });
