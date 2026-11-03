import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { MetricSink } from "@/14_OBSERVABILITY/metrics/module";
import type { TraceSink } from "@/14_OBSERVABILITY/traces/module";
import { pool } from "@/lib/admin/db";
import { expiresIn, type Auth, type RecordRepository } from "@/lib/operations/contracts";

// Storage for 13_FEEDBACK and 14_OBSERVABILITY: the shared `operations_records` table defined
// in their postgresql.sql (migrations/006_operations_records.sql). No prompt or answer text is
// stored here, only operational metadata, per 00_META/policies (redactTelemetryContent).

type Row = { id: string; auth: Auth; module: string; requestId: string; payload: unknown; expiresAt: string };

const enabled = () => Boolean(process.env.DATABASE_URL);

async function insertRows(rows: Row[], upsert = false) {
  if (!rows.length || !enabled()) return;
  const values: unknown[] = [];
  const tuples = rows.map((r, i) => {
    values.push(r.id, r.auth.tenantId, r.auth.userId, r.requestId, r.module, JSON.stringify(r.payload), r.expiresAt);
    const o = i * 7;
    return `($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6}::jsonb,$${o + 7})`;
  });
  await pool.query(
    `INSERT INTO operations_records (id, tenant_id, user_id, request_id, module, payload, expires_at)
     VALUES ${tuples.join(",")}
     ${upsert ? "ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, created_at = now(), expires_at = EXCLUDED.expires_at" : ""}`,
    values,
  );
  // Retention: occasionally purge expired rows.
  if (Math.random() < 0.02) await pool.query("DELETE FROM operations_records WHERE expires_at < now()");
}

/**
 * Collects one request's operational records and writes them in a single INSERT.
 * Implements the repository/sink interfaces the 13/14 modules expect.
 */
export class OperationsLog {
  private rows: Row[] = [];

  constructor(private auth: Auth, private requestId: string) {}

  readonly repository: RecordRepository = {
    insert: async ({ auth, module, requestId, payload, expiresAt }) => {
      const id = randomUUID();
      this.rows.push({ id, auth, module, requestId, payload, expiresAt });
      return { id };
    },
  };

  readonly traceSink: TraceSink = {
    emit: async span => { this.add("traces", span, 30); },
  };

  readonly metricSink: MetricSink = {
    record: async metric => { this.add("metrics", metric, 30); },
  };

  add(module: string, payload: unknown, days: number) {
    this.rows.push({ id: randomUUID(), auth: this.auth, module, requestId: this.requestId, payload, expiresAt: expiresIn(days) });
  }

  /** Never throws: telemetry must not break a user's request. */
  async flush() {
    const rows = this.rows.splice(0);
    try { await insertRows(rows); }
    catch (error) { console.warn("operations_records write failed:", (error as Error).message); }
  }
}

/**
 * Immediate repository for feedback. One current rating/correction per owner+request+module
 * (13_FEEDBACK/user_rating: "enforce one current rating per owner/request"), via a stable id.
 */
export const feedbackRepository: RecordRepository = {
  async insert({ auth, module, requestId, payload, expiresAt }) {
    const id = createHash("sha256").update(`${auth.tenantId}|${auth.userId}|${requestId}|${module}`).digest("hex").slice(0, 32);
    await insertRows([{ id, auth, module, requestId, payload, expiresAt }], true);
    return { id };
  },
};

/** Request ownership: feedback is only accepted from the identity that made the request. */
export async function ownsRequest(auth: Auth, requestId: string): Promise<boolean> {
  if (!enabled()) return false;
  const result = await pool.query(
    "SELECT 1 FROM operations_records WHERE module = 'request' AND request_id = $1 AND tenant_id = $2 AND user_id = $3 AND expires_at > now() LIMIT 1",
    [requestId, auth.tenantId, auth.userId],
  );
  return (result.rowCount ?? 0) > 0;
}
