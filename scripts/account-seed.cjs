// Sets this machine's local account, shown in the sidebar account menu (editable later under
// Profile). Re-running updates it. Trusted local use only.
//
//   npm run account:seed -- --name "IPMC BIT" --email ipmcbit@gmail.com [--plan plus]
//        [--workspace "IPMC BIT's Workspace" --workspace-status deactivated]
const { randomUUID } = require('node:crypto');
require('@next/env').loadEnvConfig(process.cwd());
const { Client } = require('pg');

function parse(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--(name|email|plan|workspace|workspace-status)$/.exec(argv[i]);
    if (!m || argv[i + 1] === undefined) throw new Error(`Unknown or incomplete option: ${argv[i]}`);
    out[m[1]] = argv[++i];
  }
  return out;
}

const initials = name => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => [...w][0]).join('').toUpperCase();

(async () => {
  const args = parse(process.argv.slice(2));
  const name = args.name?.trim(), email = args.email?.trim().toLowerCase(), plan = args.plan || 'free';
  if (!name) throw new Error('--name is required');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email || '')) throw new Error('--email is required');
  if (!['free', 'plus', 'pro'].includes(plan)) throw new Error('--plan must be free, plus, or pro');
  const status = args['workspace-status'] || 'active';
  if (!['active', 'deactivated'].includes(status)) throw new Error('--workspace-status must be active or deactivated');

  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query('BEGIN');
    let id = (await db.query('SELECT id FROM users WHERE is_local')).rows[0]?.id;
    if (id) {
      await db.query('UPDATE users SET name = $2, email = $3, plan = $4, avatar_initials = $5, updated_at = now() WHERE id = $1', [id, name, email, plan, initials(name)]);
    } else {
      id = randomUUID();
      await db.query('INSERT INTO users (id, email, name, avatar_initials, plan, is_local) VALUES ($1, $2, $3, $4, $5, true)', [id, email, name, initials(name), plan]);
    }
    // Every account has a personal workspace.
    const personal = (await db.query('SELECT w.id FROM workspaces w WHERE owner_id = $1 AND is_personal', [id])).rows[0]?.id;
    if (!personal) {
      const wid = randomUUID();
      await db.query("INSERT INTO workspaces (id, name, owner_id, is_personal, status) VALUES ($1, 'Personal account', $2, true, 'active')", [wid, id]);
      await db.query("INSERT INTO user_workspaces (user_id, workspace_id, role) VALUES ($1, $2, 'owner')", [id, wid]);
    }
    if (args.workspace) {
      const existing = (await db.query('SELECT id FROM workspaces WHERE owner_id = $1 AND name = $2 AND NOT is_personal', [id, args.workspace])).rows[0]?.id;
      if (existing) await db.query('UPDATE workspaces SET status = $2 WHERE id = $1', [existing, status]);
      else {
        const wid = randomUUID();
        await db.query('INSERT INTO workspaces (id, name, owner_id, is_personal, status) VALUES ($1, $2, $3, false, $4)', [wid, args.workspace, id, status]);
        await db.query("INSERT INTO user_workspaces (user_id, workspace_id, role) VALUES ($1, $2, 'owner')", [id, wid]);
      }
    }
    await db.query('COMMIT');
    console.log(`Local account: ${name} <${email}> (${plan})${args.workspace ? `; workspace "${args.workspace}" is ${status}` : ''}.`);
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await db.end();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
