import { pool } from "@/lib/admin/db";
export async function query<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
  let index = 0;
  return (await pool.query(sql.replace(/\?/g, () => "$" + (++index)), [...params])).rows as T[];
}
export async function execute(sql: string, params: readonly unknown[]) {
  await query(sql, params);
}
