// Local provisioning only. PGPASSWORD is supplied by the operator, never stored here.
const { Client } = require('pg');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');

(async () => {
  const admin = new Client({ host: 'localhost', port: 5432, user: 'postgres', database: 'postgres' });
  await admin.connect();
  try {
    if ((await admin.query("SELECT 1 FROM pg_database WHERE datname='az_ai'")).rowCount) {
      console.log('az_ai already exists; keeping its database and credentials.');
      return;
    }
    if ((await admin.query("SELECT 1 FROM pg_roles WHERE rolname='az_ai_app'")).rowCount) {
      throw new Error('az_ai_app already exists; configure its credentials explicitly.');
    }
    const password = randomBytes(32).toString('hex');
    await admin.query(`CREATE ROLE az_ai_app LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE`);
    await admin.query('CREATE DATABASE az_ai OWNER az_ai_app');
    const envPath = '.env.local';
    let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    env = env.replace(/^DATABASE_URL=.*\r?\n?/gm, '').replace(/^DB_DIALECT=.*\r?\n?/gm, '');
    fs.writeFileSync(envPath, env.trimEnd() + `\nDATABASE_URL=postgresql://az_ai_app:${password}@localhost:5432/az_ai\nDB_DIALECT=postgresql\n`);
    console.log('Created az_ai with a dedicated application role; saved connection in ignored .env.local.');
  } finally { await admin.end(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
