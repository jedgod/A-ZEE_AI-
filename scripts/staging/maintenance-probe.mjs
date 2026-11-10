#!/usr/bin/env node
// Fixture helper for the maintenance worker on the native staging stack.
//   node scripts/staging/maintenance-probe.mjs inject            -> {"uid","rid","period"}  (a stale 'running' request that holds one charge)
//   node scripts/staging/maintenance-probe.mjs check <uid> <rid> <period>   -> {"status","charged","used"}
//   node scripts/staging/maintenance-probe.mjs cleanup <uid>
import pg from "pg";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const base = process.env.STAGING_BASE || "G:/A-Z_AI/staging-local";
const c = new pg.Client({ connectionString: readFileSync(`${base}/secrets/AZEE_MIGRATION_DATABASE_URL`, "utf8").trim() }); await c.connect();
const [cmd, uid0, rid0, period0] = process.argv.slice(2);
try {
  if (cmd === "inject") {
    const uid = randomUUID(), rid = randomUUID(), period = new Date().toISOString().slice(0, 7) + "-01";
    await c.query("INSERT INTO users (id,email,name,avatar_initials,email_verified_at) VALUES ($1,$2,'Maint','MT',now())", [uid, `maint-${uid.slice(0, 8)}@example.test`]);
    await c.query("INSERT INTO linqext_usage (user_id,period_start,used) VALUES ($1,$2,1)", [uid, period]);
    await c.query("INSERT INTO linqext_requests (user_id,request_id,payload_hash,status,charged_period,created_at) VALUES ($1,$2,'h','running',$3, now() - interval '10 minutes')", [uid, rid, period]);
    console.log(JSON.stringify({ uid, rid, period }));
  } else if (cmd === "check") {
    const r = (await c.query("SELECT status, charged_period FROM linqext_requests WHERE request_id = $1", [rid0])).rows[0];
    const u = (await c.query("SELECT used FROM linqext_usage WHERE user_id = $1 AND period_start = $2", [uid0, period0])).rows[0];
    console.log(JSON.stringify({ status: r?.status, charged: r?.charged_period ?? null, used: u?.used }));
  } else if (cmd === "cleanup") { await c.query("DELETE FROM users WHERE id = $1", [uid0]); }
} finally { await c.end(); }
