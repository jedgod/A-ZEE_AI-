import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import path from "node:path";
import pg from "pg";
import { bootstrap, DATABASES, ROLES } from "../scripts/staging/db-bootstrap.mjs";

// Needs the disposable PostgreSQL 16 binaries (PG16_BIN, default G:\pg16-cert\x\pgsql\bin); skipped when absent.
const BIN = process.env.PG16_BIN || "G:/pg16-cert/x/pgsql/bin";
const have = (() => { try { execFileSync(path.join(BIN, "pg_ctl.exe"), ["--version"], { stdio: "pipe" }); return true; } catch { return false; } })();
const PORT = 54391; let dir: string; const pw: Record<string, string> = {}; let adminPw = "";
const url = (user: string, password: string, db: string) => `postgres://${user}:${encodeURIComponent(password)}@127.0.0.1:${PORT}/${db}`;
const tryConnect = async (user: string, db: string) => { const c = new pg.Client({ connectionString: url(user, pw[user], db), connectionTimeoutMillis: 4000 }); try { await c.connect(); await c.query("SELECT 1"); return c; } catch (e) { await c.end().catch(() => {}); return (e as Error).message; } };

describe.skipIf(!have)("azee-staging-local PostgreSQL 16 bootstrap", () => {
  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "pgstg-")); adminPw = randomBytes(18).toString("hex"); writeFileSync(path.join(dir, "pw"), adminPw);
    for (const r of ROLES) pw[r] = randomBytes(18).toString("hex");
    execFileSync(path.join(BIN, "initdb.exe"), ["-D", path.join(dir, "data"), "-U", "postgres", "--auth=scram-sha-256", `--pwfile=${path.join(dir, "pw")}`, "-E", "UTF8", "--locale=C"], { stdio: "pipe" });
    writeFileSync(path.join(dir, "data", "postgresql.conf"), `listen_addresses='127.0.0.1'\nport=${PORT}\nshared_buffers=64MB\nmax_connections=30\n`, { flag: "a" });
    spawnSync(path.join(BIN, "pg_ctl.exe"), ["-D", path.join(dir, "data"), "-l", path.join(dir, "log"), "-w", "-t", "60", "start"], { stdio: "ignore", windowsHide: true, timeout: 90_000 });
    const adminUrl = url("postgres", adminPw, "postgres");
    await bootstrap({ adminUrl, passwords: pw });
    await bootstrap({ adminUrl, passwords: pw });                                  // idempotent: second run must not fail
  }, 120_000);
  afterAll(() => { spawnSync(path.join(BIN, "pg_ctl.exe"), ["-D", path.join(dir, "data"), "-m", "immediate", "stop"], { stdio: "ignore", windowsHide: true, timeout: 60_000 }); setTimeout(() => rmSync(dir, { recursive: true, force: true }), 1500); });

  it("creates two separate databases owned by different roles; no role is superuser or BYPASSRLS", async () => {
    const a = new pg.Client({ connectionString: url("postgres", adminPw, "postgres") }); await a.connect();
    const dbs = (await a.query("SELECT d.datname, r.rolname owner FROM pg_database d JOIN pg_roles r ON r.oid=d.datdba WHERE datname LIKE '%_staging'")).rows;
    expect(Object.fromEntries(dbs.map((d) => [d.datname, d.owner]))).toEqual({ azee_staging: "azee_owner", aztrade_staging: "aztrade_owner" });
    const bad = (await a.query("SELECT rolname FROM pg_roles WHERE rolname = ANY($1) AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication)", [ROLES])).rows;
    expect(bad).toEqual([]); await a.end();
  });
  it("each runtime role connects to its own database only (A-Zee cannot reach AZTrade and the reverse)", async () => {
    for (const [db, { runtime, owner }] of Object.entries(DATABASES)) for (const r of [owner, ...runtime]) {
      const mine = await tryConnect(r, db); expect(typeof mine, `${r} -> ${db}`).not.toBe("string"); if (typeof mine !== "string") await mine.end();
      const other = Object.keys(DATABASES).find((d) => d !== db)!;
      expect(await tryConnect(r, other), `${r} must be refused by ${other}`).toMatch(/permission denied|not allowed|rejected/i);
      expect(await tryConnect(r, "postgres"), `${r} must be refused by the postgres database`).toMatch(/permission denied|not allowed|rejected/i);
    }
  });
  it("runtime roles cannot create objects or change schema; the owner can; A-Zee's runtime role gets DML on owner-created tables only", async () => {
    const o = await tryConnect("azee_owner", "azee_staging") as pg.Client; await o.query("CREATE TABLE t_probe (id int primary key, v text)"); await o.query("CREATE SEQUENCE s_probe");
    const app = await tryConnect("azee_app", "azee_staging") as pg.Client;
    await expect(app.query("CREATE TABLE evil (id int)")).rejects.toThrow(/permission denied/);
    await expect(app.query("DROP TABLE t_probe")).rejects.toThrow(/must be owner/);
    await app.query("INSERT INTO t_probe VALUES (1,'x')"); expect((await app.query("SELECT v FROM t_probe")).rows[0].v).toBe("x");
    await expect(app.query("TRUNCATE t_probe")).rejects.toThrow(/permission denied/);
    await app.end(); await o.end();
    const t = await tryConnect("aztrade_app", "aztrade_staging") as pg.Client; await expect(t.query("CREATE TABLE evil (id int)")).rejects.toThrow(/permission denied/); await t.end();
  });
  it("rejects weak passwords", async () => { await expect(bootstrap({ adminUrl: url("postgres", adminPw, "postgres"), passwords: { ...pw, azee_app: "short" } })).rejects.toThrow(/shorter than 24/); });
});

// AZTrade schema application on the bootstrapped roles. Needs the separate AZTrade repository (AZTRADE_REPO, default ../AZTrade).
const REPO = path.resolve(process.env.AZTRADE_REPO || path.join(__dirname, "..", "..", "AZTrade"));
const script = path.join(REPO, "backend", "scripts", "apply-schema.mjs");
describe.skipIf(!have || !existsSync(script))("AZTrade schema on the staging roles", () => {
  const dir2 = () => mkdtempSync(path.join(tmpdir(), "pgstg2-"));
  it("applies schema + migrations + grants as the owner, is idempotent, and leaves the runtime role unable to write money tables directly", async () => {
    const d = dir2(); const adminPw2 = randomBytes(18).toString("hex"); const port = 54392; const p2: Record<string, string> = {};
    for (const r of ROLES) p2[r] = randomBytes(18).toString("hex");
    writeFileSync(path.join(d, "pw"), adminPw2);
    execFileSync(path.join(BIN, "initdb.exe"), ["-D", path.join(d, "data"), "-U", "postgres", "--auth=scram-sha-256", `--pwfile=${path.join(d, "pw")}`, "-E", "UTF8", "--locale=C"], { stdio: "ignore" });
    writeFileSync(path.join(d, "data", "postgresql.conf"), `listen_addresses='127.0.0.1'\nport=${port}\nshared_buffers=64MB\nmax_connections=30\n`, { flag: "a" });
    spawnSync(path.join(BIN, "pg_ctl.exe"), ["-D", path.join(d, "data"), "-l", path.join(d, "log"), "-w", "-t", "60", "start"], { stdio: "ignore", windowsHide: true, timeout: 90_000 });
    const u = (user: string, pass: string, db: string) => `postgres://${user}:${encodeURIComponent(pass)}@127.0.0.1:${port}/${db}`;
    try {
      await bootstrap({ adminUrl: u("postgres", adminPw2, "postgres"), passwords: p2 });
      const run = () => execFileSync("node", [script], { env: { ...process.env, MIGRATION_DATABASE_URL: u("aztrade_owner", p2.aztrade_owner, "aztrade_staging") }, encoding: "utf8" });
      const first = run(); expect(first).toMatch(/aztrade_schema_ok/); expect(first).toMatch(/applied migrations\/008/);
      const second = run(); expect(second).toMatch(/skip migrations\/008/); expect(second).not.toMatch(/applied migrations/);   // idempotent
      const app = new pg.Client({ connectionString: u("aztrade_app", p2.aztrade_app, "aztrade_staging") }); app.on("error", () => {}); await app.connect();
      try {
      await expect(app.query("INSERT INTO paper_ledger DEFAULT VALUES")).rejects.toThrow(/permission denied/);
      await expect(app.query("UPDATE paper_accounts SET cash = 1")).rejects.toThrow(/permission denied/);
      await expect(app.query("CREATE TABLE evil (id int)")).rejects.toThrow(/permission denied/);
      } finally { await app.end(); }
      const own = new pg.Client({ connectionString: u("aztrade_owner", p2.aztrade_owner, "aztrade_staging") }); await own.connect();
      expect((await own.query("SELECT count(*)::int n FROM aztrade_schema_migrations")).rows[0].n).toBeGreaterThanOrEqual(9);
      await own.end();
      // refuses to run as a superuser
      await expect(Promise.resolve().then(() => execFileSync("node", [script], { env: { ...process.env, MIGRATION_DATABASE_URL: u("postgres", adminPw2, "aztrade_staging") }, stdio: "pipe" }))).rejects.toThrow();
    } finally { spawnSync(path.join(BIN, "pg_ctl.exe"), ["-D", path.join(d, "data"), "-m", "immediate", "stop"], { stdio: "ignore", windowsHide: true, timeout: 60_000 }); setTimeout(() => rmSync(d, { recursive: true, force: true }), 1500); }
  }, 180_000);
});
