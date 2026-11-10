// Builds the isolated certification database inside a DISPOSABLE PostgreSQL 16 instance.
//
//   AZTRADE_CERT_DISPOSABLE=YES \
//   AZTRADE_CERT_ADMIN_URL=postgres://postgres:...@127.0.0.1:54329/postgres \
//   AZTRADE_CERT_OUT=/path/outside/the/repo/cert-config.json \
//   [AZTRADE_CERT_PGCTL=/path/to/pg_ctl AZTRADE_CERT_DATADIR=/path/to/data] \
//   node scripts/cert-provision.mjs
//
// It creates three least-privilege roles (migration owner, provisioner, application), applies schema.sql,
// migrations 001-007 and the grants, seeds reference data, and writes a config file with the connection URLs.
// It refuses to run against anything that is not a local, throwaway instance.
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sqlDir = path.join(here, '..', 'sql');
const fail = (m) => { console.error(`REFUSING: ${m}`); process.exit(2); };

if (process.env.AZTRADE_CERT_DISPOSABLE !== 'YES') fail('set AZTRADE_CERT_DISPOSABLE=YES after verifying the instance is disposable');
const adminUrl = process.env.AZTRADE_CERT_ADMIN_URL || fail('AZTRADE_CERT_ADMIN_URL is required');
const outFile = process.env.AZTRADE_CERT_OUT || fail('AZTRADE_CERT_OUT is required (a path outside the repository)');
const u = new URL(adminUrl);
if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(u.hostname)) fail(`host ${u.hostname} is not local`);
if (u.port === '5432' || u.port === '') fail('port 5432 is the default server port; use a dedicated port for the disposable instance');

const DB = 'aztrade_cert';
const names = { owner: 'aztrade_owner', prov: 'aztrade_provisioner', app: 'aztrade_app', md: 'aztrade_marketdata', backup: 'aztrade_backup' };
const ident = /^[a-z_][a-z0-9_]{0,62}$/;
for (const n of [DB, ...Object.values(names)]) if (!ident.test(n)) fail(`bad identifier ${n}`);
const secret = () => randomBytes(24).toString('hex');
const pw = { owner: secret(), prov: secret(), app: secret(), md: secret(), backup: secret() };
const urlFor = (role, pass, db = DB) => `postgres://${role}:${pass}@${u.hostname === '::1' ? '[::1]' : u.hostname}:${u.port}/${db}`;

const admin = new pg.Client({ connectionString: adminUrl });
await admin.connect();
try {
  const { rows: [v] } = await admin.query("SELECT current_setting('server_version_num')::int AS v, current_user AS who, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS su");
  if (v.v < 160000 || v.v >= 170000) fail(`PostgreSQL 16 required, got ${v.v}`);
  if (!v.su) fail('the admin URL must be the throwaway cluster\'s superuser (used only to create roles and the database)');
  // Isolation guard: the cluster may hold only the system databases and a previous certification database.
  const { rows: others } = await admin.query("SELECT datname FROM pg_database WHERE NOT datistemplate AND datname NOT IN ('postgres', $1)", [DB]);
  if (others.length) fail(`cluster contains other databases (${others.map(r => r.datname).join(', ')}); it is not a dedicated disposable instance`);

  await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  for (const r of Object.values(names)) await admin.query(`DROP ROLE IF EXISTS ${r}`);
  const base = 'LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT';
  await admin.query(`CREATE ROLE ${names.owner} ${base} PASSWORD '${pw.owner}'`);
  await admin.query(`CREATE ROLE ${names.prov} ${base} PASSWORD '${pw.prov}'`);
  await admin.query(`CREATE ROLE ${names.app} ${base} PASSWORD '${pw.app}'`);
  await admin.query(`CREATE ROLE ${names.md} ${base} PASSWORD '${pw.md}'`);
  // Backup role: read-only, BYPASSRLS (tables are FORCE RLS, so even the owner would dump zero rows). Only a superuser can grant BYPASSRLS.
  await admin.query(`CREATE ROLE ${names.backup} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS INHERIT PASSWORD '${pw.backup}'`);
  await admin.query(`GRANT pg_read_all_data TO ${names.backup}`);
  await admin.query(`CREATE DATABASE ${DB} OWNER ${names.owner}`);
  await admin.query(`REVOKE ALL ON DATABASE ${DB} FROM PUBLIC`);
  await admin.query(`GRANT CONNECT ON DATABASE ${DB} TO ${names.prov}, ${names.app}, ${names.md}, ${names.backup}`);
} finally { await admin.end(); }

// Everything below runs as the (non-superuser) migration owner, exactly as a real deployment would.
const owner = new pg.Client({ connectionString: urlFor(names.owner, pw.owner) });
await owner.connect();
try {
  await owner.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
  const run = async (rel) => { await owner.query(fs.readFileSync(path.join(sqlDir, rel), 'utf8')); console.log(`  applied ${rel}`); };
  await run('schema.sql');
  for (const f of fs.readdirSync(path.join(sqlDir, 'migrations')).filter(f => /^\d{3}_.*\.sql$/.test(f)).sort()) await run(`migrations/${f}`);
  await run('seed.sql');
  const grants = fs.readFileSync(path.join(sqlDir, 'roles', 'app_grants.sql'), 'utf8')
    .replaceAll('{{APP_ROLE}}', names.app).replaceAll('{{PROVISIONER_ROLE}}', names.prov).replaceAll('{{MARKETDATA_ROLE}}', names.md);
  await owner.query(grants);
  console.log('  applied roles/app_grants.sql');
} finally { await owner.end(); }

const config = {
  disposable: true,
  ownerUrl: urlFor(names.owner, pw.owner),
  provisionerUrl: urlFor(names.prov, pw.prov),
  appUrl: urlFor(names.app, pw.app),
  marketdataUrl: urlFor(names.md, pw.md),
  backupUrl: urlFor(names.backup, pw.backup),
  adminUrl,
  pgCtl: process.env.AZTRADE_CERT_PGCTL || null,
  dataDir: process.env.AZTRADE_CERT_DATADIR || null,
  port: Number(u.port),
};
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(config, null, 2), { mode: 0o600 });
console.log(`Certification database ready. Config written to ${outFile}`);
