// Transaction-scoped tenant context. Call ONLY with a verified user identity.
// Routes must migrate from pool.query to withUserTransaction before RLS is enabled.
import pool from './db.js';

export async function withUserTransaction(identity, operation) {
  if (!identity?.id || !identity?.tenant_id) throw new Error('Verified user and tenant required');
  const client = await pool.connect();
  // See request-db.js: a checked-out client needs its own 'error' listener or a database restart kills the process.
  const onClientError = (error) => console.error('database connection error during transaction', error.code || error.message);
  client.on('error', onClientError);
  let dead = false;
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL row_security = on');
    await client.query("SELECT set_config('app.current_user_id', $1, true)", [String(identity.id)]);
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [String(identity.tenant_id)]);
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { dead = true; /* preserve the original error; discard the dead connection */ }
    throw error;
  } finally {
    client.removeListener('error', onClientError);
    client.release(dead);
  }
}
