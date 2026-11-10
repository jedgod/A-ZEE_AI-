#!/usr/bin/env node
// Idempotent PostgreSQL 16 bootstrap for azee-staging-local: two SEPARATE databases, separate least-privilege roles, nothing shared.
//   azee_staging     owner azee_owner        runtime azee_app          (A-Zee Next.js app)
//   aztrade_staging  owner aztrade_owner     runtime aztrade_app, aztrade_provisioner, aztrade_marketdata
// No role is a superuser or has BYPASSRLS; PUBLIC has no CONNECT; each runtime role can connect only to its own database.
// Passwords are read from files in AZEE_SECRETS_DIR (db_<role>_password); the admin password from postgres_admin_password.
//   PGHOST/PGPORT select the server (default db:5432).  Run on the private network only.
import pg from "pg";
import { readFileSync } from "node:fs";
import path from "node:path";

export const DATABASES = {
  azee_staging: { owner: "azee_owner", runtime: ["azee_app"] },
  aztrade_staging: { owner: "aztrade_owner", runtime: ["aztrade_app", "aztrade_provisioner", "aztrade_marketdata"] },
};
export const ROLES = Object.values(DATABASES).flatMap((d) => [d.owner, ...d.runtime]);
const ident = /^[a-z_][a-z0-9_]{0,62}$/;
const q = (id) => { if (!ident.test(id)) throw new Error(`bad identifier ${id}`); return `"${id}"`; };
const lit = (s) => `'${String(s).replaceAll("'", "''")}'`;

export async function bootstrap({ adminUrl, passwords }) {
  const admin = new pg.Client({ connectionString: adminUrl }); await admin.connect();
  try {
    const { rows: [me] } = await admin.query("SELECT rolsuper, current_setting('server_version_num')::int v FROM pg_roles WHERE rolname = current_user");
    if (!me.rolsuper) throw new Error("the admin connection must be the instance superuser (used only to create roles and databases)");
    if (me.v < 160000 || me.v >= 170000) throw new Error(`PostgreSQL 16 required (got ${me.v})`);
    for (const role of ROLES) {
      if (!passwords[role] || passwords[role].length < 24) throw new Error(`password for ${role} missing or shorter than 24 characters`);
      const attrs = "LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT";
      const exists = (await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role])).rowCount;
      await admin.query(`${exists ? "ALTER" : "CREATE"} ROLE ${q(role)} ${attrs} PASSWORD ${lit(passwords[role])}`);
    }
    for (const [db, { owner, runtime }] of Object.entries(DATABASES)) {
      if (!(await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [db])).rowCount) await admin.query(`CREATE DATABASE ${q(db)} OWNER ${q(owner)}`);
      await admin.query(`ALTER DATABASE ${q(db)} OWNER TO ${q(owner)}`);
      await admin.query(`REVOKE ALL ON DATABASE ${q(db)} FROM PUBLIC`);
      for (const other of ROLES) await admin.query(`REVOKE ALL ON DATABASE ${q(db)} FROM ${q(other)}`);
      await admin.query(`GRANT ALL ON DATABASE ${q(db)} TO ${q(owner)}`);   // CREATE is needed for trusted extensions (uuid-ossp) and schema objects
      for (const r of runtime) await admin.query(`GRANT CONNECT ON DATABASE ${q(db)} TO ${q(r)}`);
    }
    await admin.query("REVOKE ALL ON DATABASE postgres FROM PUBLIC");
    // Inside each database: schema public is owner-only for CREATE; runtime roles get USAGE (+ default privileges for A-Zee's runtime role).
    for (const [db, { owner, runtime }] of Object.entries(DATABASES)) {
      const url = new URL(adminUrl); url.pathname = `/${db}`;
      const c = new pg.Client({ connectionString: url.href }); await c.connect();
      try {
        await c.query(`REVOKE ALL ON SCHEMA public FROM PUBLIC`);
        await c.query(`ALTER SCHEMA public OWNER TO ${q(owner)}`);
        await c.query(`GRANT USAGE ON SCHEMA public TO ${runtime.map(q).join(", ")}`);
        if (db === "azee_staging") {   // AZTrade's per-table grants come from its own app_grants.sql; A-Zee's runtime role gets DML on what its owner creates
          await c.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${q(owner)} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${q("azee_app")}`);
          await c.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${q(owner)} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${q("azee_app")}`);
        }
      } finally { await c.end(); }
    }
  } finally { await admin.end(); }
}

if (process.argv[1]?.endsWith("db-bootstrap.mjs")) {
  const dir = process.env.AZEE_SECRETS_DIR || "/run/secrets";
  const read = (n) => readFileSync(path.join(dir, n), "utf8").trim();
  try {
    const passwords = Object.fromEntries(ROLES.map((r) => [r, read(`db_${r}_password`)]));
    const host = process.env.PGHOST || "db", port = process.env.PGPORT || "5432";
    const adminUrl = `postgres://postgres:${encodeURIComponent(read("postgres_admin_password"))}@${host}:${port}/postgres`;
    await bootstrap({ adminUrl, passwords });
    console.log(JSON.stringify({ type: "db_bootstrap_ok", databases: Object.keys(DATABASES), roles: ROLES }));
  } catch (e) { console.error("db bootstrap failed:", String(e.message).replace(/postgres:\/\/[^@\s]+@/g, "postgres://***@")); process.exit(1); }
}
