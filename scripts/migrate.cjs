const fs = require('node:fs');
const path = require('node:path');
require('@next/env').loadEnvConfig(process.cwd());
const { Client } = require('pg');

async function migrate() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query('BEGIN');
    await db.query('SELECT pg_advisory_xact_lock(18203001)');
    await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    for (const name of ['admin.postgresql.sql', '002_admin_sessions.sql', 'extensions.postgresql.sql', '005_platform_api.sql', '006_operations_records.sql', '007_accounts_operations.sql', '008_plans_subscriptions.sql', '009_rename_pro_plans.sql', '010_access_rules.sql', '011_subscription_periods.sql', '012_sidebar.sql', '013_project_settings.sql', '014_sidebar_icons.sql', '015_chat_messages.sql', '016_search_research.sql', '017_connectors.sql', '018_code_agent.sql']) {
      if ((await db.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name])).rowCount) continue;
      await db.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', name), 'utf8'));
      await db.query('INSERT INTO schema_migrations(name) VALUES($1)', [name]);
      console.log('Applied', name);
    }
    await db.query('COMMIT');
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { await db.end(); }
}
migrate().catch(error => { console.error(error.message); process.exitCode = 1; });
