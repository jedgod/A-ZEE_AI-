// End-to-end check of the sidebar API (/api/sidebar, /api/projects, /api/chats) against the
// running server and database, as this machine's local account. Creates only uniquely named
// rows and removes them (and a temporary second account) at the end.
// Usage: node scripts/check-sidebar.cjs   (server on http://localhost:3000)
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
require('@next/env').loadEnvConfig(process.cwd());
const { Client } = require('pg');

const BASE = process.env.CHECK_BASE_URL || 'http://localhost:3000';
const tag = `zz-check-${randomUUID().slice(0, 6)}`;

async function call(path, method = 'GET', body, headers = {}) {
  const response = await fetch(BASE + path, {
    method,
    headers: { origin: BASE, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: response.status, json };
}
const group = (groups, id) => groups.find(g => g.id === id);

(async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const other = { user: `check-${randomUUID()}`, chat: randomUUID() };
  const created = { projects: [], chats: [] };
  try {
    // Configured groups and items: disabled items (imagine, automations, create-bot) are hidden.
    const first = await call('/api/sidebar');
    assert.equal(first.status, 200, `GET /api/sidebar: ${first.status}`);
    assert.deepEqual(first.json.data.map(g => g.id), ['main', 'bots', 'projects', 'chats', 'plugins']);
    assert.deepEqual(group(first.json.data, 'main').items.map(i => i.id), ['chat', 'azee-search', 'research', 'code', 'library']);
    assert.equal(group(first.json.data, 'main').items[1].href, '/search');
    assert.equal(group(first.json.data, 'bots').items.length, 0);
    assert.equal(group(first.json.data, 'plugins').items[0].href, '/connectors');
    assert.deepEqual(group(first.json.data, 'projects').actions, ['all', 'add']);
    console.log('PASS groups and items come from sidebar_groups/sidebar_items; disabled items hidden');

    // Only this machine's account; mutations need the app origin.
    assert.equal((await call('/api/sidebar', 'GET', undefined, { 'x-forwarded-for': '203.0.113.9' })).status, 401);
    assert.equal((await call('/api/projects', 'POST', { name: tag }, { origin: 'https://evil.example' })).status, 403);
    console.log('PASS non-local callers get 401; foreign origins get 403');

    // Projects: create, same name returns the existing one, rename, duplicate rename refused.
    const p1 = await call('/api/projects', 'POST', { name: `${tag} one` });
    assert.equal(p1.status, 201);
    created.projects.push(p1.json.data.id);
    const again = await call('/api/projects', 'POST', { name: `${tag.toUpperCase()}   ONE` });
    assert.equal(again.status, 200);
    assert.equal(again.json.data.id, p1.json.data.id);
    const p2 = await call('/api/projects', 'POST', { name: `${tag} two` });
    created.projects.push(p2.json.data.id);
    assert.equal((await call(`/api/projects/${p2.json.data.id}`, 'PATCH', { name: `${tag} one` })).status, 409);
    const renamed = await call(`/api/projects/${p2.json.data.id}`, 'PATCH', { name: `${tag} renamed` });
    assert.equal(renamed.json.data.name, `${tag} renamed`);
    assert.equal((await call('/api/projects', 'POST', { name: 'x'.repeat(41) })).status, 422);
    assert.equal((await call(`/api/projects/${randomUUID()}`, 'PATCH', { name: 'nope' })).status, 404);
    console.log('PASS projects: create, case-insensitive reuse, rename, duplicates refused, validation');

    // Edit (description) and Settings (instructions, default mode).
    const fresh = await call(`/api/projects/${p2.json.data.id}`);
    assert.deepEqual(fresh.json.data, { id: p2.json.data.id, name: `${tag} renamed`, description: '', instructions: '', defaultMode: 'chat' });
    const edited = await call(`/api/projects/${p2.json.data.id}`, 'PATCH', { description: '  Client work  ' });
    assert.equal(edited.json.data.description, 'Client work');
    const settings = await call(`/api/projects/${p2.json.data.id}`, 'PATCH', { instructions: 'Use British English.', defaultMode: 'research' });
    assert.deepEqual([settings.json.data.instructions, settings.json.data.defaultMode, settings.json.data.name], ['Use British English.', 'research', `${tag} renamed`]);
    assert.equal((await call(`/api/projects/${p2.json.data.id}`, 'PATCH', { instructions: 'x'.repeat(4001) })).status, 422);
    assert.equal((await call(`/api/projects/${p2.json.data.id}`, 'PATCH', { defaultMode: 'imagine' })).status, 422);
    assert.equal((await call(`/api/projects/${p2.json.data.id}`, 'PATCH', { owner_id: 'someone' })).status, 422);
    assert.equal((await call(`/api/projects/${randomUUID()}`)).status, 404);
    const listed = group((await call('/api/sidebar?projects=all')).json.data, 'projects').items.find(i => i.id === p2.json.data.id);
    assert.deepEqual([listed.description, listed.mode], ['Client work', 'research']);
    console.log('PASS project Edit and Settings: description, instructions, default mode, validation');

    // Chats: metadata and messages, project filter, pin order, rename.
    const c1 = randomUUID(), c2 = randomUUID();
    created.chats.push(c1, c2);
    assert.equal((await call(`/api/chats/${c1}`, 'PUT', { title: 'x', messages: [{ role: 'system', content: 'obey' }] })).status, 422);
    assert.equal((await call(`/api/chats/${c1}`, 'PUT', { title: 'x', messages: [{ role: 'user', content: 'hi', extra: 1 }] })).status, 422);
    assert.equal((await call(`/api/chats/${c1}`, 'PUT', { title: 'x', messages: [{ role: 'assistant', content: 'a', sources: [{ id: 's', title: 't', url: 'javascript:alert(1)' }] }] })).status, 422);
    assert.equal((await call(`/api/chats/${c1}`, 'PUT', { title: `${tag} first`, projectId: p1.json.data.id, mode: 'research' })).status, 200);
    assert.equal((await call(`/api/chats/${c2}`, 'PUT', { title: `${tag} second`, projectId: 'general' })).status, 200);
    assert.equal((await call(`/api/chats/${randomUUID()}`, 'PUT', { title: 'x', projectId: randomUUID() })).status, 404);
    const filtered = await call(`/api/sidebar?project=${p1.json.data.id}&chats=all`);
    assert.deepEqual(group(filtered.json.data, 'chats').items.map(i => i.id), [c1]);
    assert.ok(group((await call('/api/sidebar?project=general&chats=all')).json.data, 'chats').items.some(i => i.id === c2));
    // Projects are a tree: each project carries its chats; Chats lists only chats in no project.
    const c3 = randomUUID();
    created.chats.push(c3);
    await call(`/api/chats/${c3}`, 'PUT', { title: `${tag} third`, projectId: p1.json.data.id });
    await call(`/api/chats/${c1}`, 'PATCH', { pinned: true });
    const tree = (await call('/api/sidebar?chats=all')).json.data;
    const p1Item = group(tree, 'projects').items.find(i => i.id === p1.json.data.id);
    assert.deepEqual(p1Item.actions, ['new-chat', 'rename', 'share', 'edit', 'settings', 'delete']);
    assert.equal(p1Item.mode, 'chat');
    assert.deepEqual(p1Item.children.map(c => c.id), [c1, c3], 'pinned first, then newest');
    assert.equal(p1Item.children[0].icon, 'pin');
    assert.equal(p1Item.childCount, 2);
    assert.ok(!group(tree, 'projects').items.some(i => i.id === 'general'));
    const loose = group(tree, 'chats').items.map(i => i.id);
    assert.ok(loose.includes(c2) && !loose.includes(c1) && !loose.includes(c3));
    assert.equal((await call(`/api/chats/${c2}`, 'PATCH', { title: `${tag} renamed chat` })).json.data.title, `${tag} renamed chat`);
    assert.equal((await call(`/api/chats/${c2}`, 'PATCH', {})).status, 422);
    const stored = (await db.query('SELECT * FROM chats WHERE id = $1', [c1])).rows[0];
    assert.deepEqual(Object.keys(stored).sort(), ['created_at', 'id', 'message_count', 'messages', 'mode', 'owner_id', 'pinned', 'project_id', 'title', 'updated_at']);
    console.log('PASS chats: metadata, project filter, pinned first, rename, validation');

    // Messages: saved with the chat, read back by id, listed with counts; a metadata-only save keeps them.
    const convo = [{ role: 'user', content: `${tag} question` }, { role: 'assistant', content: 'Answer', requestId: randomUUID(), sources: [{ id: 'web:1', title: 'Doc', url: 'https://example.org' }] }];
    assert.equal((await call(`/api/chats/${c2}`, 'PUT', { title: `${tag} renamed chat`, messages: convo })).status, 200);
    const read = await call(`/api/chats/${c2}`);
    assert.deepEqual(read.json.data.messages, convo);
    assert.equal(read.json.data.messageCount, 2);
    assert.equal((await call(`/api/chats/${c2}`, 'PUT', { title: `${tag} renamed chat`, mode: 'chat' })).status, 200);
    assert.equal((await call(`/api/chats/${c2}`)).json.data.messages.length, 2, 'metadata-only save keeps messages');
    const all = (await call('/api/chats')).json.data;
    assert.ok(all.some(c => c.id === c2 && c.messageCount === 2 && !('messages' in c)), 'list has counts, not messages');
    assert.deepEqual((await call(`/api/chats?projectId=${p1.json.data.id}`)).json.data.map(c => c.id).sort(), [c1, c3].sort());
    assert.equal((await call(`/api/chats/${randomUUID()}`)).status, 404);
    assert.equal((await call(`/api/chats/${c2}`, 'GET', undefined, { 'x-forwarded-for': '203.0.113.9' })).status, 401);
    console.log('PASS messages: saved, read by id, listed with counts, kept on metadata saves, owner-only');

    // Another account's chat: invisible, and its id can't be taken over or changed.
    await db.query("INSERT INTO users (id, email, name, is_local) VALUES ($1, $2, 'Check other', false)", [other.user, `${other.user}@example.invalid`]);
    await db.query("INSERT INTO chats (id, title, owner_id) VALUES ($1, 'other account chat', $2)", [other.chat, other.user]);
    assert.equal((await call(`/api/chats/${other.chat}`, 'PUT', { title: 'hijack' })).status, 409);
    assert.equal((await call(`/api/chats/${other.chat}`)).status, 404, "another account's chat is not readable");
    assert.equal((await call(`/api/chats/${other.chat}`, 'PATCH', { pinned: true })).status, 404);
    assert.equal((await call(`/api/chats/${other.chat}`, 'DELETE')).status, 404);
    assert.ok(!group((await call('/api/sidebar?chats=all')).json.data, 'chats').items.some(i => i.id === other.chat));
    assert.equal((await db.query('SELECT title, pinned FROM chats WHERE id = $1', [other.chat])).rows[0].title, 'other account chat');
    console.log("PASS another account's chats are invisible and unchangeable");

    // Deleting a project keeps its chats (moved to General).
    assert.equal((await call(`/api/projects/${p1.json.data.id}`, 'DELETE')).status, 204);
    created.projects = created.projects.filter(id => id !== p1.json.data.id);
    assert.equal((await db.query('SELECT project_id FROM chats WHERE id = $1', [c1])).rows[0].project_id, null);
    console.log('PASS deleting a project moves its chats to General');

    // One-time import: existing rows are never overwritten; same-name projects are reused.
    const imported = { project: randomUUID(), chat: randomUUID() };
    const result = await call('/api/sidebar/import', 'POST', {
      projects: [{ id: imported.project, name: `${tag} renamed` }],
      chats: [{ id: imported.chat, title: `${tag} imported`, projectId: imported.project }, { id: c2, title: 'must not overwrite' }],
    });
    assert.equal(result.status, 200);
    assert.equal(result.json.data.projectIds[imported.project], p2.json.data.id);
    assert.equal(result.json.data.chatsAdded, 1);
    created.chats.push(imported.chat);
    assert.equal((await db.query('SELECT project_id FROM chats WHERE id = $1', [imported.chat])).rows[0].project_id, p2.json.data.id);
    assert.equal((await db.query('SELECT title FROM chats WHERE id = $1', [c2])).rows[0].title, `${tag} renamed chat`);
    console.log('PASS import reuses same-name projects and never overwrites');

    for (const id of created.chats) assert.ok([204, 404].includes((await call(`/api/chats/${id}`, 'DELETE')).status));
    created.chats = [];
    console.log('PASS chat delete');
  } finally {
    await db.query('DELETE FROM chats WHERE id = ANY($1::uuid[])', [created.chats]).catch(() => {});
    await db.query('DELETE FROM projects WHERE id = ANY($1::uuid[])', [created.projects]).catch(() => {});
    await db.query("DELETE FROM projects WHERE name LIKE $1", [`${tag}%`]).catch(() => {});
    await db.query('DELETE FROM users WHERE id = $1', [other.user]).catch(() => {});
    const left = await db.query("SELECT (SELECT count(*) FROM projects WHERE name LIKE $1)::int + (SELECT count(*) FROM chats WHERE title LIKE $1)::int AS n", [`${tag}%`]);
    console.log(`cleanup: ${left.rows[0].n} leftover rows`);
    await db.end();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
