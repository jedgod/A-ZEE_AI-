const assert = require('node:assert/strict');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const { Client } = require('pg');
require('@next/env').loadEnvConfig(process.cwd());

(async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  const user = randomUUID(), tenant = randomUUID(), session = randomUUID(), keyId = randomUUID();
  const token = randomBytes(32).toString('hex'), apiToken = 'az_' + randomBytes(32).toString('hex');
  const hash = value => createHash('sha256').update(value).digest('hex');
  const base = process.env.APP_ORIGIN || 'http://localhost:3000';
  await db.connect();
  async function request(path, method = 'GET', body, extra = {}) {
    const response = await fetch(base + path, {
      method, headers: { Cookie: `az_session=${token}`, Origin: base, 'Content-Type': 'application/json', ...extra },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000),
    });
    const result = await response.text();
    return { status: response.status, data: result ? JSON.parse(result) : null };
  }
  try {
    await db.query('INSERT INTO admin_identities(id,email,platform_admin) VALUES($1,$2,true)', [user, `${user}@runtime-test.invalid`]);
    await db.query('INSERT INTO admin_tenants(id,name,owner_user_id) VALUES($1,$2,$3)', [tenant, `Runtime check ${tenant}`, user]);
    await db.query("INSERT INTO admin_memberships(tenant_id,user_id,role,status) VALUES($1,$2,'owner','active')", [tenant,user]);
    await db.query("INSERT INTO admin_sessions(id,token_hash,user_id,tenant_id,role,platform,expires_at) VALUES($1,$2,$3,$4,'owner',true,now()+interval '5 minutes')", [session,hash(token),user,tenant]);
    for (const path of ['/api/admin/me','/api/admin/dashboard','/api/admin/tenants','/api/admin/users','/api/extensions']) {
      const response = await request(path);
      assert.equal(response.status, 200, `${path}: ${JSON.stringify(response.data)}`);
      console.log('PASS',path);
    }
    const created = await request('/api/admin/policies','POST',{ name: 'Runtime check', rules: ['Verify database wiring'] });
    assert.equal(created.status,201,JSON.stringify(created.data));
    const stored = await db.query('SELECT created_by FROM admin_records WHERE id=$1',[created.data.id]);
    assert.equal(stored.rows[0].created_by,user);
    const removed = await request(`/api/admin/policies/${created.data.id}?revision=1`,'DELETE');
    assert.equal(removed.status,204);
    console.log('PASS admin create/delete and actor audit identity');
    await db.query("INSERT INTO platform_api_keys(id,token_hash,user_id,tenant_id,scopes,expires_at) VALUES($1,$2,$3,$4,ARRAY['chat:write'],now()+interval '5 minutes')",[keyId,hash(apiToken),user,tenant]);
    assert.equal((await request('/api/v1/chat','POST',{})).status,401);
    assert.equal((await request('/api/v1/chat','POST',{}, { Authorization: `Bearer ${apiToken}` })).status,422);
    assert.equal((await request('/api/v1/status','GET',undefined)).status,401);
    const status = await request('/api/v1/status','GET',undefined,{ Authorization: `Bearer ${apiToken}` });
    assert.equal(status.status,200,JSON.stringify(status.data));
    assert.equal(status.data.data.keyId,keyId);
    assert.deepEqual(status.data.data.scopes,['chat:write']);
    console.log('PASS platform token authentication and input validation');
    await db.query("UPDATE admin_memberships SET role='viewer' WHERE tenant_id=$1 AND user_id=$2",[tenant,user]);
    assert.equal((await request('/api/admin/policies','POST',{ name: 'Denied',rules:[] })).status,403);
    console.log('PASS immediate membership downgrade');
    assert.equal((await request('/api/admin/session/logout','POST')).status,200);
    assert.equal((await request('/api/admin/me')).status,401);
    console.log('PASS logout revocation');
    // 13_FEEDBACK: only the browser that received an answer may rate it; one rating per request.
    const owner = randomUUID(), stranger = randomUUID(), reqId = randomUUID();
    await db.query("INSERT INTO operations_records(id,tenant_id,user_id,request_id,module,payload,expires_at) VALUES($1,'local',$2,$3,'request','{}'::jsonb,now()+interval '5 minutes')", [randomUUID(), owner, reqId]);
    const feedback = (uid, body) => fetch(base + '/api/feedback', { method: 'POST', headers: { Cookie: `az_uid=${uid}`, Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await feedback(stranger, { requestId: reqId, rating: 5 })).status, 404);
    assert.equal((await feedback(owner, { requestId: reqId, rating: 5 })).status, 201);
    assert.equal((await feedback(owner, { requestId: reqId, rating: 1, correction: 'Email me at x@y.com instead' })).status, 201);
    const fb = await db.query("SELECT module, payload FROM operations_records WHERE request_id=$1 AND module<>'request' ORDER BY module", [reqId]);
    assert.deepEqual(fb.rows.map(r => r.module), ['correction_capture', 'user_rating']);
    assert.equal(fb.rows[1].payload.rating, 1);
    assert.ok(!JSON.stringify(fb.rows[0].payload).includes('x@y.com'), 'correction must be stored redacted');
    await db.query('DELETE FROM operations_records WHERE request_id=$1', [reqId]);
    console.log('PASS feedback ownership, single current rating, redacted correction');
  } finally {
    await db.query('DELETE FROM platform_api_limits WHERE key_id=$1',[keyId]);
    await db.query('DELETE FROM platform_api_keys WHERE id=$1',[keyId]);
    await db.query('DELETE FROM admin_sessions WHERE id=$1',[session]);
    await db.query('DELETE FROM admin_audit WHERE tenant_id=$1',[tenant]);
    await db.query('DELETE FROM admin_records WHERE tenant_id=$1',[tenant]);
    await db.query('DELETE FROM admin_memberships WHERE tenant_id=$1',[tenant]);
    await db.query('DELETE FROM admin_tenants WHERE id=$1',[tenant]);
    await db.query('DELETE FROM admin_identities WHERE id=$1',[user]);
    for (const kind of ['w','r']) await db.query('DELETE FROM admin_rate_limits WHERE key=$1',[hash(`${user}:${tenant}:${kind}`)]);
    await db.end();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
