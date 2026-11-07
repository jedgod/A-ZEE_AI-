// Activates a plan for this machine's local account (e.g. after payment is confirmed outside the
// app, since no payment provider is connected). Trusted local use only.
//   npm run plan:set -- --plan plus [--billing annual] [--paid 14.99] [--email user@example.com]
const { randomUUID } = require('node:crypto');
require('@next/env').loadEnvConfig(process.cwd());
const { Client } = require('pg');

(async () => {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const m = /^--(plan|billing|paid|email)$/.exec(argv[i]);
    if (!m || argv[i + 1] === undefined) throw new Error(`Unknown or incomplete option: ${argv[i]}`);
    args[m[1]] = argv[++i];
  }
  const billing = args.billing || 'monthly';
  if (!['monthly', 'annual'].includes(billing)) throw new Error('--billing must be monthly or annual');
  const paid = args.paid === undefined ? null : Number(args.paid);
  if (paid !== null && !(paid >= 0)) throw new Error('--paid must be a non-negative amount');
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query('BEGIN');
    const plan = (await db.query('SELECT id, name FROM plans WHERE id = $1 AND is_active', [args.plan])).rows[0];
    if (!plan) throw new Error(`Unknown plan "${args.plan}". Plans: ${(await db.query('SELECT id FROM plans ORDER BY sort_order')).rows.map(r => r.id).join(', ')}`);
    // --email picks any account (accounts claimed through sign-up are no longer "local").
    const user = (args.email
      ? await db.query('SELECT id, name, region FROM users WHERE lower(email) = lower($1)', [args.email])
      : await db.query('SELECT id, name, region FROM users WHERE is_local')).rows[0];
    if (!user) throw new Error(args.email ? `No account with email ${args.email}.` : 'No local account yet. Pass --email <account email>, or run: npm run account:seed -- --name "..." --email ...');
    await db.query("UPDATE subscriptions SET status = 'canceled', ends_at = now() WHERE user_id = $1 AND status IN ('active', 'pending')", [user.id]);
    await db.query("INSERT INTO subscriptions (id, user_id, plan_id, status, region, price_paid, billing) VALUES ($1, $2, $3, 'active', $4, $5, $6)", [randomUUID(), user.id, plan.id, user.region, paid, billing]);
    await db.query('UPDATE users SET plan = $2, updated_at = now() WHERE id = $1', [user.id, plan.id]);
    await db.query('COMMIT');
    console.log(`${user.name} is now on ${plan.name} (${billing}).`);
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await db.end();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
