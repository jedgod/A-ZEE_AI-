// ============================================================
// 15_ADMIN / DATABASE CONNECTION
// ============================================================
import "server-only";
import { Pool, type PoolClient } from "pg";

const shared = globalThis as unknown as { adminPool?: Pool };
export const pool = shared.adminPool ?? new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 5000,
  ssl: process.env.POSTGRES_SSL === "true" ? { rejectUnauthorized: true } : undefined,
});
shared.adminPool = pool;

export async function transaction<T>(
  run: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
