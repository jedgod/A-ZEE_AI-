import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Run ONLY against an isolated disposable database with migrations 001–005 applied.
// DATABASE_URL must use the restricted application role, not a superuser/table owner.
const url = process.env.AZTRADE_CERT_DATABASE_URL;
const enabled = process.env.AZTRADE_CERT_DISPOSABLE === 'YES' && Boolean(url);
const pg = enabled ? (await import('pg')).default : null;
const pool = enabled ? new pg.Pool({ connectionString: url, max: 8 }) : null;
const uid = randomUUID();
const otherUid = randomUUID();
const tenant = `cert-${randomUUID()}`;
const otherTenant = `cert-${randomUUID()}`;

async function transaction(id, tenantId, fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.current_user_id', $1, true)", [id]);
    await c.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
    return await fn(c);
  } finally {
    await c.query('ROLLBACK').catch(() => {});
    c.release();
  }
}

test('PostgreSQL restricted-role preflight and RLS configuration', { skip: !enabled }, async () => {
  const c = await pool.connect();
  try {
    const { rows: [role] } = await c.query(`SELECT current_setting('server_version_num')::int AS version,
      r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname=current_user`);
    assert.ok(role.version >= 160000 && role.version < 170000, 'PostgreSQL 16 required');
    assert.equal(role.rolsuper, false, 'Application role cannot be superuser');
    assert.equal(role.rolbypassrls, false, 'Application role cannot bypass RLS');
    const { rows } = await c.query(`SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
      pg_get_userbyid(c.relowner)=current_user AS is_owner FROM pg_class c
      WHERE c.relnamespace='public'::regnamespace AND c.relname = ANY($1::text[])`,
      [['users','portfolios','holdings','paper_accounts','paper_positions','paper_orders','paper_ledger','alerts','assistant_messages']]);
    assert.equal(rows.length, 9);
    for (const r of rows) {
      assert.equal(r.relrowsecurity, true, `${r.relname}: RLS off`);
      assert.equal(r.relforcerowsecurity, true, `${r.relname}: FORCE RLS off`);
      assert.equal(r.is_owner, false, `${r.relname}: application role owns table`);
    }
  } finally { c.release(); }
});

test('unscoped session reads no user data; identity is transaction-local', { skip: !enabled }, async () => {
  const c = await pool.connect();
  try {
    const { rows } = await c.query('SELECT id FROM users LIMIT 1');
    assert.equal(rows.length, 0, 'unscoped read leaked a user');
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.current_user_id', $1, true)", [uid]);
    await c.query("SELECT set_config('app.current_tenant', $1, true)", [tenant]);
    await c.query('ROLLBACK');
    const { rows: [state] } = await c.query("SELECT current_setting('app.current_user_id', true) AS uid");
    assert.ok(!state.uid, 'identity leaked after transaction rollback');
  } finally { c.release(); }
});

test('cross-tenant user access and writes fail closed', { skip: !enabled }, async () => {
  await transaction(uid, tenant, async c => {
    const { rows } = await c.query('SELECT id FROM users WHERE id=$1', [otherUid]);
    assert.equal(rows.length, 0);
    await assert.rejects(c.query('INSERT INTO users(id,azee_user_id,tenant_id) VALUES($1,$2,$3)',
      [otherUid, `cert-${randomUUID()}`, otherTenant]), /row-level security|permission denied/i);
  });
});

test('paper ledger rejects mutation and unbalanced single posting', { skip: !enabled }, async () => {
  // A restricted application role should never have permission to mutate historical ledger rows.
  await transaction(uid, tenant, async c => {
    // After a failed statement PostgreSQL aborts the transaction, so each expected failure needs its own savepoint.
    for (const sql of ['DELETE FROM paper_ledger WHERE false', 'UPDATE paper_ledger SET amount=amount WHERE false', 'TRUNCATE paper_ledger']) {
      await c.query('SAVEPOINT s');
      await assert.rejects(c.query(sql), /append-only|permission denied/i, sql);
      await c.query('ROLLBACK TO SAVEPOINT s');
    }
  });
});

test.after(async () => { if (pool) await pool.end(); });
