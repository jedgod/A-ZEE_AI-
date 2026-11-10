#!/usr/bin/env node
// More fixtures for the maintenance worker. node scripts/staging/maintenance-probe-extra.mjs mismatch | purge-fixtures
import pg from "pg";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
const base = process.env.STAGING_BASE || "G:/A-Z_AI/staging-local";
const c = new pg.Client({ connectionString: readFileSync(`${base}/secrets/AZEE_MIGRATION_DATABASE_URL`, "utf8").trim() }); await c.connect();
try {
  if (process.argv[2] === "mismatch") {   // a failed request that still claims a charge, but there is NO usage row to refund: the books disagree
    const uid = randomUUID(), period = new Date().toISOString().slice(0, 7) + "-01";
    await c.query("INSERT INTO users (id,email,name,avatar_initials,email_verified_at) VALUES ($1,$2,'Maint','MT',now())", [uid, `maint-${uid.slice(0, 8)}@example.test`]);
    await c.query("INSERT INTO linqext_requests (user_id,request_id,payload_hash,status,charged_period) VALUES ($1,$2,'h','failed',$3)", [uid, randomUUID(), period]);
    console.log(uid);
  } else if (process.argv[2] === "purge-fixtures") {
    const r = await c.query("DELETE FROM users WHERE email LIKE 'maint-%@example.test' OR email LIKE 'verify-%@example.test' OR email LIKE 'recovery-%@example.test'"); console.log(`removed ${r.rowCount} fixture users`);
  }
} finally { await c.end(); }
