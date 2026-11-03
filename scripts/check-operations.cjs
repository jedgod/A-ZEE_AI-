// End-to-end check of staff sign-in and the complaints workflow against the running app and
// database. Creates a throwaway team and accounts, exercises every role boundary, then removes
// everything it created.   npm run check:operations   (app must be running on APP_ORIGIN)
const assert = require('node:assert/strict');
const { randomBytes, randomUUID, scrypt } = require('node:crypto');
require('@next/env').loadEnvConfig(process.cwd());
const { Client } = require('pg');

const base = process.env.APP_ORIGIN || 'http://localhost:3000';
const hash = password => new Promise((resolve, reject) => {
  const salt = randomBytes(16), N = 2 ** 15, r = 8, p = 1;
  scrypt(password.normalize('NFKC'), salt, 64, { N, r, p, maxmem: 128 * N * r * 2 }, (e, key) =>
    e ? reject(e) : resolve(`scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`));
});

function client(cookie = '') {
  const jar = { cookie };
  async function call(path, method = 'GET', body) {
    const res = await fetch(base + path, {
      method,
      headers: { Origin: base, 'Content-Type': 'application/json', ...(jar.cookie ? { Cookie: jar.cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    const set = res.headers.get('set-cookie');
    if (set) jar.cookie = set.split(';')[0];
    const text = await res.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
    return { status: res.status, json, headers: res.headers, text };
  }
  return { call, jar };
}

(async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const tenant = randomUUID(), tag = randomBytes(4).toString('hex');
  const people = {
    admin: { id: randomUUID(), email: `admin-${tag}@ops-check.invalid`, role: 'admin', name: 'Check Admin' },
    admin2: { id: randomUUID(), email: `admin2-${tag}@ops-check.invalid`, role: 'admin', name: 'Second Admin' },
    staff: { id: randomUUID(), email: `staff-${tag}@ops-check.invalid`, role: 'operator', name: 'Check Staff' },
    other: { id: randomUUID(), email: `other-${tag}@ops-check.invalid`, role: 'operator', name: 'Other Staff' },
    viewer: { id: randomUUID(), email: `viewer-${tag}@ops-check.invalid`, role: 'viewer', name: 'Check Viewer' },
  };
  const password = 'check-' + randomBytes(9).toString('base64url');
  const previousSupport = (await db.query("SELECT value FROM ops_settings WHERE key = 'support_tenant_id'")).rows[0]?.value;
  try {
    await db.query('INSERT INTO admin_tenants (id, name) VALUES ($1, $2)', [tenant, `Ops check ${tag}`]);
    const h = await hash(password);
    for (const p of Object.values(people)) {
      await db.query('INSERT INTO admin_identities (id, email, display_name, platform_admin) VALUES ($1, $2, $3, false)', [p.id, p.email, p.name]);
      await db.query("INSERT INTO admin_memberships (tenant_id, user_id, role, status) VALUES ($1, $2, $3, 'active')", [tenant, p.id, p.role]);
      await db.query('INSERT INTO admin_credentials (user_id, password_hash, must_change) VALUES ($1, $2, false)', [p.id, h]);
    }
    const login = async who => { const c = client(); const r = await c.call('/api/staff/session', 'POST', { email: people[who].email, password }); assert.equal(r.status, 200, JSON.stringify(r.json)); return c; };

    // Unauthenticated access is refused; the page redirects to sign-in.
    assert.equal((await client().call('/api/operations/complaints')).status, 401);
    const page = await client().call('/operations');
    assert.ok([307, 308].includes(page.status) && page.headers.get('location').includes('/login'));
    console.log('PASS operations require sign-in');

    // Wrong passwords: generic error, then lockout after 5 tries; unknown emails look the same.
    const anon = client();
    assert.equal((await anon.call('/api/staff/session', 'POST', { email: `nobody-${tag}@ops-check.invalid`, password: 'x' })).json.error, 'INVALID_CREDENTIALS');
    for (let i = 0; i < 4; i++) assert.equal((await anon.call('/api/staff/session', 'POST', { email: people.viewer.email, password: 'wrong' })).status, 401);
    assert.equal((await anon.call('/api/staff/session', 'POST', { email: people.viewer.email, password: 'wrong' })).status, 423);
    assert.equal((await anon.call('/api/staff/session', 'POST', { email: people.viewer.email, password })).status, 423, 'locked even with the right password');
    await db.query('UPDATE admin_credentials SET failed_attempts = 0, locked_until = NULL WHERE user_id = $1', [people.viewer.id]);
    console.log('PASS sign-in errors are generic; 5 failures lock the account');

    const admin = await login('admin'), admin2 = await login('admin2'), staff = await login('staff'), other = await login('other'), viewer = await login('viewer');
    assert.match(admin.jar.cookie, /^az_session=[a-f0-9]{64}$/);

    // Create, assign, submit, approve.
    const created = await admin.call('/api/operations/complaints', 'POST', { subject: 'Charged twice', customerName: 'Alex Morgan', customerContact: 'alex@example.com', body: 'Duplicate charge on my card.', priority: 'high' });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    let c = created.json.data;
    assert.equal(c.status, 'open');
    assert.equal((await viewer.call('/api/operations/complaints', 'POST', { subject: 'x', customerName: 'x', body: 'x' })).status, 403);
    assert.equal((await staff.call(`/api/operations/complaints/${c.id}`, 'POST', { action: 'assign', version: c.version, assigneeId: people.staff.id })).status, 404, 'staff cannot see unassigned work');
    assert.equal((await viewer.call(`/api/operations/complaints/${c.id}`, 'POST', { action: 'assign', version: c.version, assigneeId: people.staff.id })).status, 403);
    const assigned = await admin.call(`/api/operations/complaints/${c.id}`, 'POST', { action: 'assign', version: c.version, assigneeId: people.staff.id });
    assert.equal(assigned.status, 200, JSON.stringify(assigned.json));
    assert.equal((await admin.call(`/api/operations/complaints/${c.id}`, 'POST', { action: 'reprioritize', version: c.version, priority: 'low' })).status, 409, 'stale version');
    c = assigned.json.data;
    assert.equal(c.status, 'in_progress');
    console.log('PASS create, role-limited creation, assignment, stale-version conflict');

    const staffList = (await staff.call('/api/operations/complaints')).json.data;
    assert.deepEqual(staffList.map(x => x.id), [c.id]);
    assert.equal((await other.call('/api/operations/complaints')).json.data.length, 0);
    assert.equal((await other.call(`/api/operations/complaints/${c.id}`)).status, 404);
    assert.equal((await staff.call(`/api/operations/complaints/${c.id}`, 'POST', { action: 'submit', version: c.version, resolution: '   ' })).status, 422);
    const submitted = await staff.call(`/api/operations/complaints/${c.id}`, 'POST', { action: 'submit', version: c.version, resolution: 'Refunded the duplicate charge.' });
    assert.equal(submitted.status, 200, JSON.stringify(submitted.json));
    c = submitted.json.data;
    assert.equal((await staff.call(`/api/operations/complaints/${c.id}`, 'POST', { action: 'approve', version: c.version })).status, 403, 'staff cannot approve');
    console.log('PASS staff see only their work and submit; cannot approve');

    const returned = await admin.call(`/api/operations/complaints/${c.id}`, 'POST', { action: 'return', version: c.version, note: 'Mention the refund timeline.' });
    c = returned.json.data;
    assert.equal(c.status, 'in_progress');
    c = (await staff.call(`/api/operations/complaints/${c.id}`, 'POST', { action: 'submit', version: c.version, resolution: 'Refunded; arrives in 3-5 business days.' })).json.data;
    const approved = await admin.call(`/api/operations/complaints/${c.id}`, 'POST', { action: 'approve', version: c.version });
    assert.equal(approved.status, 200, JSON.stringify(approved.json));
    assert.equal(approved.json.data.status, 'resolved');
    const outbox = await db.query('SELECT recipient FROM notification_outbox WHERE complaint_id = $1', [c.id]);
    assert.deepEqual(outbox.rows.map(r => r.recipient), ['alex@example.com']);
    const events = await db.query('SELECT action, detail FROM complaint_events WHERE complaint_id = $1 ORDER BY id', [c.id]);
    assert.deepEqual(events.rows.map(e => e.action), ['created', 'assign', 'submit', 'return', 'submit', 'approve']);
    assert.ok(!JSON.stringify(events.rows).includes('Duplicate charge'), 'audit never stores complaint text');
    console.log('PASS send back, resubmit, approve; outbox queued; audit trail without complaint text');

    // Separation of duties: an admin can't approve their own submission; another admin can.
    let own = (await admin.call('/api/operations/complaints', 'POST', { subject: 'Self-handled', customerName: 'Sam', body: 'x', assigneeId: people.admin.id })).json.data;
    own = (await admin.call(`/api/operations/complaints/${own.id}`, 'POST', { action: 'submit', version: own.version, resolution: 'Done.' })).json.data;
    assert.equal((await admin.call(`/api/operations/complaints/${own.id}`, 'POST', { action: 'approve', version: own.version })).status, 403);
    assert.equal((await admin2.call(`/api/operations/complaints/${own.id}`, 'POST', { action: 'approve', version: own.version })).status, 200);
    console.log('PASS administrators cannot approve their own work');

    // Staff management: temporary password, forced change, suspension ends sessions.
    const added = await admin.call('/api/operations/staff', 'POST', { email: `new-${tag}@ops-check.invalid`, name: 'New Person', role: 'operator' });
    assert.equal(added.status, 201, JSON.stringify(added.json));
    assert.ok(added.json.data.temporaryPassword);
    assert.equal((await staff.call('/api/operations/staff', 'POST', { email: `x-${tag}@ops-check.invalid`, name: 'X', role: 'admin' })).status, 403);
    const fresh = client();
    const first = await fresh.call('/api/staff/session', 'POST', { email: `new-${tag}@ops-check.invalid`, password: added.json.data.temporaryPassword });
    assert.equal(first.json.data.mustChangePassword, true);
    assert.equal((await fresh.call('/api/operations/complaints')).json.error, 'PASSWORD_CHANGE_REQUIRED');
    assert.equal((await fresh.call('/api/staff/password', 'POST', { current: added.json.data.temporaryPassword, next: 'short' })).status, 422);
    assert.equal((await fresh.call('/api/staff/password', 'POST', { current: added.json.data.temporaryPassword, next: 'a much better passphrase' })).status, 200);
    assert.equal((await fresh.call('/api/operations/complaints')).status, 200);
    assert.equal((await admin.call(`/api/operations/staff/${added.json.data.id}`, 'PATCH', { status: 'suspended' })).status, 200);
    assert.equal((await fresh.call('/api/operations/complaints')).status, 401, 'suspension ends the session');
    assert.equal((await admin.call(`/api/operations/staff/${people.admin.id}`, 'PATCH', { status: 'suspended' })).status, 422, 'cannot suspend yourself');
    console.log('PASS add staff, forced password change, suspension, self-protection');

    // App users file support requests and see the approved resolution.
    await db.query("INSERT INTO ops_settings (key, value) VALUES ('support_tenant_id', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [tenant]);
    const user = client();
    const filed = await user.call('/api/support', 'POST', { category: 'bug', subject: 'Send button stuck', body: 'It spins forever.', contact: 'user@example.com' });
    assert.equal(filed.status, 201, JSON.stringify(filed.json));
    assert.match(user.jar.cookie, /^az_uid=/);
    const queued = (await admin.call('/api/operations/complaints')).json.data.find(x => x.display === filed.json.data.id);
    assert.ok(queued && queued.source === 'app' && queued.category === 'bug');
    let q = (await admin.call(`/api/operations/complaints/${queued.id}`, 'POST', { action: 'assign', version: queued.version, assigneeId: people.staff.id })).json.data;
    q = (await staff.call(`/api/operations/complaints/${q.id}`, 'POST', { action: 'submit', version: q.version, resolution: 'Fixed in the latest update.' })).json.data;
    let mine = (await user.call('/api/support')).json.data[0];
    assert.equal(mine.status, 'pending_review');
    assert.equal(mine.resolution, null, 'unapproved resolutions stay hidden');
    await admin.call(`/api/operations/complaints/${q.id}`, 'POST', { action: 'approve', version: q.version });
    mine = (await user.call('/api/support')).json.data[0];
    assert.equal(mine.resolution, 'Fixed in the latest update.');
    assert.equal((await client().call('/api/support')).json.data.length, 0, 'other browsers see nothing');
    console.log('PASS support requests reach the queue; users see only approved resolutions');

    const csv = await admin.call('/api/operations/export');
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    assert.ok(csv.text.includes('Charged twice'));
    assert.equal((await staff.call('/api/operations/export')).status, 403);
    assert.equal((await admin.call('/api/staff/session', 'DELETE')).status, 204);
    assert.equal((await admin.call('/api/operations/complaints')).status, 401);
    console.log('PASS CSV export (admins only); sign-out revokes the session');

    // 15: the DB-backed admin console works with a staff session.
    const admin3 = await login('admin');
    for (const page of ['/admin/dashboard', '/admin/users', '/admin/pipeline', '/admin/pipeline/07-calculator']) {
      const res = await admin3.call(page);
      assert.equal(res.status, 200, `admin console ${page}: ${res.status}`);
    }
    console.log('PASS admin console (15) opens with a staff admin session');

    // 14 audit trail: denied and allowed access changes are both recorded.
    assert.equal((await staff.call(`/api/operations/staff/${people.other.id}`, 'PATCH', { role: 'viewer' })).status, 403);
    assert.equal((await admin3.call(`/api/operations/staff/${people.other.id}`, 'PATCH', { role: 'reviewer' })).status, 200);
    const audits = await db.query("SELECT detail->>'outcome' AS outcome FROM complaint_events WHERE tenant_id = $1 AND action = 'audit:policy_change' ORDER BY id", [tenant]);
    // Earlier steps were audited too (a suspension = allowed, a self-suspension = denied).
    assert.deepEqual(audits.rows.map(r => r.outcome), ['allowed', 'denied', 'denied', 'allowed']);
    console.log('PASS 14 audit trail records denied and allowed access changes');

    // 13 improvement queue: admins see unhelpful answers and queue them once.
    const rid = randomUUID();
    await db.query("INSERT INTO operations_records (id, tenant_id, user_id, request_id, module, payload, expires_at) VALUES ($1, 'public', $2, $3, 'user_rating', '{\"rating\":1}', now() + interval '5 minutes')", [randomUUID(), randomUUID(), rid]);
    assert.equal((await staff.call('/api/operations/feedback')).status, 403);
    const listed = (await admin3.call('/api/operations/feedback')).json.data.find(f => f.requestId === rid);
    assert.ok(listed && listed.rating === 1 && !listed.queued);
    assert.equal((await admin3.call('/api/operations/feedback', 'POST', { requestId: rid })).status, 201);
    assert.equal((await admin3.call('/api/operations/feedback', 'POST', { requestId: rid })).status, 201, 'idempotent');
    assert.equal((await admin3.call('/api/operations/feedback')).json.data.find(f => f.requestId === rid).queued, true);
    assert.equal((await db.query("SELECT count(*)::int n FROM operations_records WHERE module = 'improvement_queue' AND request_id = $1", [rid])).rows[0].n, 1);
    await db.query('DELETE FROM operations_records WHERE request_id = $1', [rid]);
    console.log('PASS 13 improvement queue (admins only, deduplicated)');

    // Plans: regional pricing, pending paid subscription, enterprise to sales, monthly limit enforcement.
    const local = client();
    const account = (await local.call('/api/account')).json.data.account;
    assert.ok(account, 'local account exists');
    const before = await db.query("SELECT id, region, plan FROM users WHERE is_local");
    const subsSnapshot = (await db.query('SELECT * FROM subscriptions WHERE user_id = $1', [before.rows[0].id])).rows;
    try {
      assert.equal((await local.call('/api/account', 'PATCH', { name: account.name, email: account.email, region: 'NG' })).status, 200);
      const ng = (await local.call('/api/plans')).json.data;
      assert.equal(ng.regionalDiscount, true);
      assert.equal(ng.plans.find(p => p.id === 'plus').price, 13.49);
      assert.equal(ng.plans.find(p => p.id === 'pro25').name, 'Pro 25');
      assert.equal(ng.plans.find(p => p.id === 'enterprise').price, null);
      console.log('PASS plans from the database with 10% regional pricing (NG: Plus $13.49)');

      const pending = await local.call('/api/subscriptions', 'POST', { planId: 'go', billing: 'annual' });
      assert.equal(pending.status, 202, JSON.stringify(pending.json));
      assert.deepEqual(pending.json.data, { status: 'pending', planId: 'go', price: 45, billing: 'annual' });
      assert.equal((await local.call('/api/plans')).json.data.current.subscription.pending.planId, 'go');
      const sales = await local.call('/api/subscriptions', 'POST', { planId: 'enterprise' });
      assert.equal(sales.json.data.status, 'contact_sales');
      assert.match(sales.json.data.ticket, /^CMP-/);
      assert.equal((await client('').call('/api/subscriptions', 'POST', { planId: 'nope' })).status, 404);
      console.log('PASS paid plans wait for payment; Enterprise opens a sales request');

      // Awaiting payment (admin): list pending subscriptions and activate after payment.
      const pendingList = await admin3.call('/api/admin/subscriptions/pending');
      assert.equal(pendingList.status, 200, JSON.stringify(pendingList.json));
      const row = pendingList.json.find(r => r.email === account.email && r.plan_id === 'go');
      assert.ok(row && row.plan_name === 'Go' && row.status === 'pending', JSON.stringify(pendingList.json));
      assert.equal((await staff.call('/api/admin/subscriptions/pending')).status, 403);
      assert.equal((await staff.call(`/api/admin/subscriptions/${row.id}/activate`, 'POST')).status, 403);
      const activated = await admin3.call(`/api/admin/subscriptions/${row.id}/activate`, 'POST');
      assert.equal(activated.status, 200, JSON.stringify(activated.json));
      assert.equal(activated.json.activated.plan_id, 'go');
      assert.ok(new Date(activated.json.activated.current_period_end) > new Date(Date.now() + 300 * 864e5), 'annual billing gets a one-year period');
      assert.equal((await local.call('/api/me/access')).json.data.plan, 'go');
      const current = await db.query("SELECT plan_id FROM subscriptions WHERE user_id = $1 AND status IN ('active', 'trialing', 'past_due')", [before.rows[0].id]);
      assert.deepEqual(current.rows.map(r => r.plan_id), ['go'], 'previous plan ended in the same transaction');
      assert.equal((await admin3.call(`/api/admin/subscriptions/${row.id}/activate`, 'POST')).status, 404);
      console.log('PASS awaiting payment: admins list and activate (previous plan ended, 1-year period); staff refused');

      const planId = (await db.query('SELECT plan FROM users WHERE is_local')).rows[0].plan;
      const prior = (await db.query("SELECT monthly_limit FROM usage_limits WHERE plan_id = $1 AND feature = 'messages'", [planId])).rows[0]?.monthly_limit ?? null;
      await db.query("UPDATE usage_limits SET monthly_limit = 0 WHERE plan_id = $1 AND feature = 'messages'", [planId]);
      try {
        const limited = await local.call('/api/chat', 'POST', { messages: [{ role: 'user', content: 'Hello' }] });
        assert.equal(limited.status, 429, JSON.stringify(limited.json));
        assert.equal(limited.json.error, 'PLAN_LIMIT_REACHED');
        assert.equal(limited.json.feature, 'messages');
      } finally {
        await db.query("UPDATE usage_limits SET monthly_limit = $2 WHERE plan_id = $1 AND feature = 'messages'", [planId, prior]);
      }
      console.log('PASS monthly plan limits stop chat before any AI call');

      // Feature entitlements (subscription access rules): a feature off for the plan is refused.
      const attachmentsBefore = (await db.query("SELECT enabled FROM plan_entitlements WHERE plan_id = $1 AND feature = 'attachments'", [planId])).rows[0].enabled;
      await db.query("UPDATE plan_entitlements SET enabled = false WHERE plan_id = $1 AND feature = 'attachments'", [planId]);
      try {
        const gated = await local.call('/api/chat', 'POST', { messages: [{ role: 'user', content: 'Summarize\n\nAttached file: notes.txt\nhello' }] });
        assert.equal(gated.status, 403, JSON.stringify(gated.json));
        assert.deepEqual([gated.json.error, gated.json.feature], ['UPGRADE_REQUIRED', 'attachments']);
        const me = (await local.call('/api/me/access')).json.data;
        assert.equal(me.entitlements.find(e => e.feature === 'attachments').enabled, false);
        const logged = await db.query("SELECT decision FROM access_audit WHERE feature = 'attachments' ORDER BY id DESC LIMIT 1");
        assert.equal(logged.rows[0].decision, 'upgrade_required');
      } finally {
        await db.query("UPDATE plan_entitlements SET enabled = $2 WHERE plan_id = $1 AND feature = 'attachments'", [planId, attachmentsBefore]);
      }
      console.log('PASS features off for the plan return 403 UPGRADE_REQUIRED and are audited');
    } finally {
      await db.query("UPDATE users SET region = $1, plan = $2 WHERE is_local", [before.rows[0].region, before.rows[0].plan]);
      await db.query('DELETE FROM subscriptions WHERE user_id = $1', [before.rows[0].id]);
      for (const sub of subsSnapshot) {
        const cols = Object.keys(sub);
        await db.query(`INSERT INTO subscriptions (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})`, cols.map(c => sub[c]));
      }
    }
  } finally {
    if (previousSupport) await db.query("UPDATE ops_settings SET value = $1 WHERE key = 'support_tenant_id'", [previousSupport]);
    else await db.query("DELETE FROM ops_settings WHERE key = 'support_tenant_id' AND value = $1", [tenant]);
    const ids = (await db.query('SELECT user_id FROM admin_memberships WHERE tenant_id = $1', [tenant])).rows.map(r => r.user_id);
    await db.query('DELETE FROM notification_outbox WHERE tenant_id = $1', [tenant]);
    await db.query('DELETE FROM complaint_events WHERE tenant_id = $1', [tenant]);
    await db.query('DELETE FROM complaints WHERE tenant_id = $1', [tenant]);
    await db.query('DELETE FROM admin_sessions WHERE tenant_id = $1', [tenant]);
    await db.query('DELETE FROM admin_memberships WHERE tenant_id = $1', [tenant]);
    await db.query('DELETE FROM admin_credentials WHERE user_id = ANY($1::uuid[])', [ids]);
    await db.query('DELETE FROM admin_identities WHERE id = ANY($1::uuid[])', [ids]);
    await db.query('DELETE FROM admin_tenants WHERE id = $1', [tenant]);
    await db.end();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
