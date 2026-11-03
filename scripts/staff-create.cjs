// Creates a staff or admin sign-in for the operations workspace. Trusted local use only
// (direct database access); there is deliberately no public sign-up endpoint.
//
//   npm run staff:create -- --email you@example.com --name "Your Name" --role admin [--team "Support desk"]
//   npm run staff:create -- --email sam@example.com --name "Sam Lee" --role operator
//
// Roles: admin (assign, approve, manage staff), operator/reviewer (staff: resolve assigned
// complaints), viewer (read-only). The first team created becomes the support desk that receives
// complaints from the app. A one-time password is printed (or read from AZ_STAFF_PASSWORD) and
// must be changed at first sign-in.
const { randomBytes, randomUUID, scrypt } = require('node:crypto');
require('@next/env').loadEnvConfig(process.cwd());
const { Client } = require('pg');

function parse(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--(email|name|role|team)$/.exec(argv[i]);
    if (!m || argv[i + 1] === undefined) throw new Error(`Unknown or incomplete option: ${argv[i]}`);
    out[m[1]] = argv[++i];
  }
  return out;
}

const hash = password => new Promise((resolve, reject) => {
  const salt = randomBytes(16), N = 2 ** 15, r = 8, p = 1;
  scrypt(password.normalize('NFKC'), salt, 64, { N, r, p, maxmem: 128 * N * r * 2 }, (error, key) =>
    error ? reject(error) : resolve(`scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`));
});

(async () => {
  const args = parse(process.argv.slice(2));
  const email = (args.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('--email is required');
  if (!args.name?.trim()) throw new Error('--name is required');
  const role = args.role || 'operator';
  if (!['admin', 'operator', 'reviewer', 'viewer'].includes(role)) throw new Error('--role must be admin, operator, reviewer, or viewer');
  const password = process.env.AZ_STAFF_PASSWORD || randomBytes(12).toString('base64url');
  if (password.length < 12) throw new Error('AZ_STAFF_PASSWORD must be at least 12 characters');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required (see .env.local)');

  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query('BEGIN');
    const setting = await db.query("SELECT value FROM ops_settings WHERE key = 'support_tenant_id'");
    let tenantId = setting.rows[0]?.value;
    if (!tenantId || args.team) {
      const team = args.team || 'Support desk';
      tenantId = (await db.query('SELECT id FROM admin_tenants WHERE name = $1 AND deleted_at IS NULL', [team])).rows[0]?.id;
      if (!tenantId) {
        tenantId = randomUUID();
        await db.query('INSERT INTO admin_tenants (id, name) VALUES ($1, $2)', [tenantId, team]);
      }
      await db.query("INSERT INTO ops_settings (key, value) VALUES ('support_tenant_id', $1) ON CONFLICT (key) DO NOTHING", [tenantId]);
    }
    let userId = (await db.query('SELECT id FROM admin_identities WHERE lower(email) = $1', [email])).rows[0]?.id;
    if (!userId) {
      userId = randomUUID();
      await db.query('INSERT INTO admin_identities (id, email, display_name, platform_admin) VALUES ($1, $2, $3, false)', [userId, email, args.name.trim()]);
    } else {
      await db.query('UPDATE admin_identities SET display_name = $2 WHERE id = $1', [userId, args.name.trim()]);
    }
    await db.query(
      `INSERT INTO admin_memberships (tenant_id, user_id, role, status) VALUES ($1, $2, $3, 'active')
       ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = EXCLUDED.role, status = 'active', updated_at = now()`,
      [tenantId, userId, role],
    );
    await db.query(
      `INSERT INTO admin_credentials (user_id, password_hash, must_change) VALUES ($1, $2, true)
       ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, must_change = true, failed_attempts = 0, locked_until = NULL, updated_at = now()`,
      [userId, await hash(password)],
    );
    await db.query('COMMIT');
    const team = (await db.query('SELECT name FROM admin_tenants WHERE id = $1', [tenantId])).rows[0].name;
    console.log(`${args.name.trim()} <${email}> is now ${role} of "${team}".`);
    if (!process.env.AZ_STAFF_PASSWORD) console.log(`One-time password (shown once; must be changed at first sign-in):\n${password}`);
    console.log('Sign in at /login');
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await db.end();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
