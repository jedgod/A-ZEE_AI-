// ============================================================
// 15_EXTENSIONS / DATABASE ADAPTER
// Install: pg, better-sqlite3; dev: @types/pg @types/better-sqlite3
// ============================================================
import "server-only";
import { Pool } from "pg";
import Database from "better-sqlite3";

const dialect = process.env.DB_DIALECT ?? "sqlite";
if (!["sqlite", "postgresql"].includes(dialect)) {
  throw new Error("Unsupported database dialect");
}
const pool = dialect === "postgresql"
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null;
const sqlite = dialect === "sqlite"
  ? new Database(process.env.SQLITE_PATH ?? "extensions.sqlite")
  : null;
sqlite?.pragma("journal_mode = WAL");
sqlite?.pragma("foreign_keys = ON");

export async function query<T>(
  sql: string, params: readonly unknown[] = []
): Promise<T[]> {
  if (pool) {
    let index = 0;
    const postgresSql = sql.replace(/\?/g, () => "$" + (++index));
    return (await pool.query(postgresSql, [...params])).rows as T[];
  }
  return sqlite!.prepare(sql).all(...params) as T[];
}

export async function execute(sql: string, params: readonly unknown[]) {
  if (pool) {
    let index = 0;
    await pool.query(sql.replace(/\?/g, () => "$" + (++index)), [...params]);
  } else {
    sqlite!.prepare(sql).run(...params);
  }
}

// Only application-owned SQL may use this placeholder conversion.
// Do not pass user SQL or SQL containing literal '?' characters.
// For serverless production, use managed pooling or a native driver.
