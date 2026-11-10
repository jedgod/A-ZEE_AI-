// Negative controls: prove the certification tests have teeth. Each mutation deliberately breaks the posting
// procedure in the disposable database, runs the relevant suites, and REQUIRES them to fail. The original function is
// restored afterwards. Requires the disposable instance from scripts/run-certification.ps1 (-Negative).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const cfgPath = process.env.AZTRADE_CERT_CONFIG;
if (process.env.AZTRADE_CERT_DISPOSABLE !== 'YES' || !cfgPath) { console.error('REFUSING: needs AZTRADE_CERT_DISPOSABLE=YES and AZTRADE_CERT_CONFIG'); process.exit(2); }
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const migration = fs.readFileSync(path.join(here, '..', 'sql', 'migrations', '007_posting_procedure_and_reconciliation.sql'), 'utf8');
const fnStart = migration.indexOf('CREATE OR REPLACE FUNCTION aztrade_place_paper_order');
const fnEnd = migration.indexOf('REVOKE ALL ON FUNCTION aztrade_place_paper_order');
const original = migration.slice(fnStart, fnEnd);

const mutations = [
  { name: 'A. no account row lock (FOR UPDATE removed from the account read)',
    from: 'SELECT * INTO v_acct FROM paper_accounts WHERE user_id = v_user FOR UPDATE;', to: 'SELECT * INTO v_acct FROM paper_accounts WHERE user_id = v_user;',
    suites: ['tests/cert-concurrency.test.js'] },
  { name: 'B. cash moved by the UNROUNDED notional while the ledger records the rounded one',
    from: 'UPDATE paper_accounts SET cash = cash - v_notional WHERE id = v_acct.id;', to: 'UPDATE paper_accounts SET cash = cash - (p_shares * v_price) WHERE id = v_acct.id;',
    suites: ['tests/cert-posting.test.js'] },
  { name: 'C. idempotent replay disabled (a retry posts again)',
    from: "    RETURN jsonb_build_object('replay', true, 'order', to_jsonb(v_prior));", to: "    NULL;",
    suites: ['tests/cert-posting.test.js', 'tests/cert-concurrency.test.js'] },
];

async function apply(sql) {
  const c = new pg.Client({ connectionString: cfg.ownerUrl });
  await c.connect();
  try { await c.query(sql); } finally { await c.end(); }
}
function runSuites(suites) {
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-concurrency=1', ...suites], {
    cwd: path.join(here, '..'), encoding: 'utf8', env: process.env, timeout: 600000, maxBuffer: 1 << 26 });
  const out = `${r.stdout}${r.stderr}`;
  const get = (k) => Number((out.match(new RegExp(`^# ${k} (\\d+)`, 'm')) || [])[1] ?? NaN);
  return { tests: get('tests'), pass: get('pass'), fail: get('fail') };
}

let allCaught = true;
try {
  for (const m of mutations) {
    if (!original.includes(m.from)) throw new Error(`mutation target not found in the migration: ${m.name}`);
    await apply(original.replace(m.from, m.to));
    const r = runSuites(m.suites);
    const caught = r.fail > 0;
    allCaught &&= caught;
    console.log(`${caught ? 'CAUGHT ' : 'MISSED '} ${m.name}  -> ${r.fail} of ${r.tests} tests failed`);
  }
} finally {
  await apply(original);                                   // always restore the real procedure
  console.log('original posting procedure restored');
}
const clean = runSuites(['tests/cert-posting.test.js', 'tests/cert-concurrency.test.js']);
console.log(`restored procedure: ${clean.pass} of ${clean.tests} pass, ${clean.fail} fail`);
process.exit(allCaught && clean.fail === 0 ? 0 : 1);
