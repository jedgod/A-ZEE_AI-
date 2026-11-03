// Issues, lists, and revokes AZee Connect API tokens for IDE clients.
// Trusted local use only (direct DB access); never expose this as an HTTP route.
//
//   npm run connect:token -- --local [--days 30] [--name "Laptop VS Code"]
//   npm run connect:token -- --user USER_UUID --tenant TENANT_UUID [--days 30]
//   npm run connect:token -- --list
//   npm run connect:token -- --revoke KEY_ID
const { randomBytes, randomUUID, createHash } = require('node:crypto');
require('@next/env').loadEnvConfig(process.cwd());
const { Client } = require('pg');

const LOCAL_EMAIL = 'local-developer@localhost.invalid';
const LOCAL_TENANT = 'Local workspace';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parse(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--')) throw new Error(`Unexpected argument: ${key}`);
    const name = key.slice(2);
    if (['local', 'list'].includes(name)) args[name] = true;
    else if (['user', 'tenant', 'days', 'revoke', 'name'].includes(name) && argv[i + 1] !== undefined) args[name] = argv[++i];
    else throw new Error(`Unknown or incomplete option: ${key}`);
  }
  return args;
}

async function localMember(db) {
  let user = (await db.query('SELECT id FROM admin_identities WHERE email=$1', [LOCAL_EMAIL])).rows[0]?.id;
  if (!user) {
    user = randomUUID();
    await db.query('INSERT INTO admin_identities(id,email,platform_admin) VALUES($1,$2,false)', [user, LOCAL_EMAIL]);
  }
  let tenant = (await db.query('SELECT id FROM admin_tenants WHERE name=$1 AND deleted_at IS NULL', [LOCAL_TENANT])).rows[0]?.id;
  if (!tenant) {
    tenant = randomUUID();
    await db.query('INSERT INTO admin_tenants(id,name,owner_user_id) VALUES($1,$2,$3)', [tenant, LOCAL_TENANT, user]);
  }
  await db.query(
    "INSERT INTO admin_memberships(tenant_id,user_id,role,status) VALUES($1,$2,'operator','active') ON CONFLICT (tenant_id,user_id) DO NOTHING",
    [tenant, user]
  );
  return { user, tenant };
}

async function main() {
  const args = parse(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required (see .env.local).');
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    if (args.list) {
      const { rows } = await db.query(
        `SELECT k.id, i.email, t.name AS tenant, k.scopes, k.expires_at, k.revoked_at
         FROM platform_api_keys k
         LEFT JOIN admin_identities i ON i.id = k.user_id
         LEFT JOIN admin_tenants t ON t.id = k.tenant_id
         ORDER BY k.expires_at DESC`
      );
      if (!rows.length) console.log('No AZee Connect tokens.');
      for (const r of rows) {
        const state = r.revoked_at ? 'revoked' : new Date(r.expires_at) < new Date() ? 'expired' : 'active';
        console.log(`${r.id}  ${state.padEnd(7)}  expires ${new Date(r.expires_at).toISOString().slice(0, 10)}  ${r.email ?? r.id} @ ${r.tenant ?? '?'}  [${r.scopes.join(',')}]`);
      }
      return;
    }
    if (args.revoke) {
      if (!UUID.test(args.revoke)) throw new Error('--revoke needs a key ID (see --list).');
      const result = await db.query('UPDATE platform_api_keys SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL', [args.revoke]);
      console.log(result.rowCount ? `Revoked ${args.revoke}.` : 'No active token with that ID.');
      return;
    }

    const days = args.days === undefined ? 30 : Number(args.days);
    if (!Number.isInteger(days) || days < 1 || days > 90) throw new Error('--days must be a whole number from 1 to 90.');
    let member;
    if (args.local) member = await localMember(db);
    else if (UUID.test(args.user ?? '') && UUID.test(args.tenant ?? '')) member = { user: args.user, tenant: args.tenant };
    else throw new Error('Use --local, or --user USER_UUID --tenant TENANT_UUID. Also: --list, --revoke KEY_ID.');

    const active = await db.query(
      `SELECT 1 FROM admin_memberships m JOIN admin_tenants t ON t.id = m.tenant_id
       WHERE m.user_id=$1 AND m.tenant_id=$2 AND m.status='active' AND t.status='active' AND t.deleted_at IS NULL`,
      [member.user, member.tenant]
    );
    if (!active.rowCount) throw new Error('That user has no active membership in that tenant.');

    const token = 'az_' + randomBytes(32).toString('hex');
    const id = randomUUID();
    await db.query(
      `INSERT INTO platform_api_keys(id,token_hash,user_id,tenant_id,scopes,expires_at)
       VALUES($1,$2,$3,$4,ARRAY['chat:write'],now() + make_interval(days => $5))`,
      [id, createHash('sha256').update(token).digest('hex'), member.user, member.tenant, days]
    );
    console.log(`Key ID:  ${id}${args.name ? `  (${args.name})` : ''}`);
    console.log(`Expires: in ${days} days`);
    console.log(`Token (shown once; store it in your IDE or AZEE_TOKEN):\n${token}`);
  } finally {
    await db.end();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
