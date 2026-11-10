import pool from './db.js';

// One DB transaction and transaction-local identity for every protected request.
// IMPORTANT: The application DB role must be non-owner, without BYPASSRLS.
export async function requestDb(req, res, next) {
  const { id, tenant_id } = req.user || {};
  if (!/^[0-9a-f-]{36}$/i.test(String(id || '')) || !tenant_id) {
    return res.status(403).json({ error: 'Provisioned tenant identity required' });
  }
  let client;
  // A checked-out connection that the server kills (restart, crash, failover) emits an 'error' event. With no listener
  // Node treats it as an uncaught exception and the whole API process dies. The pool only listens while a client is idle,
  // so every checked-out client needs its own listener. The failing query rejects separately and is handled by the route.
  const onClientError = (error) => console.error('database connection error during request', error.code || error.message);
  try {
    client = await pool.connect();
    client.on('error', onClientError);
    await client.query('BEGIN');
    await client.query('SET LOCAL row_security = on');
    await client.query("SELECT set_config('app.current_user_id', $1, true)", [id]);
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [String(tenant_id)]);
    req.db = client;
    let settled = false;
    const finish = async () => {
      if (settled) return;
      settled = true;
      let dead = false;
      try { await client.query('ROLLBACK'); }
      catch { dead = true; }           // if even ROLLBACK fails the connection is gone: discard it instead of pooling it
      finally { client.removeListener('error', onClientError); client.release(dead); }
    };
    // Queries in handlers use this client; read requests are rolled back after response.
    // Mutating handlers must commit explicitly before sending a success response.
    res.once('finish', () => { void finish().catch(console.error); });
    res.once('close', () => { void finish().catch(console.error); });
    next();
  } catch (error) {
    if (client) {
      let dead = false;
      try { await client.query('ROLLBACK'); } catch { dead = true; }
      client.removeListener('error', onClientError);
      client.release(dead);
    }
    // The database being unavailable is a retryable outage, not an application fault.
    if (isConnectionError(error)) return res.status(503).json({ error: 'Database unavailable; retry shortly' });
    next(error);
  }
}

/** Errors that mean the connection or server went away (restart, crash, failover) rather than that the request was wrong. */
export function isConnectionError(error) {
  const code = error?.code;
  return ['ECONNRESET', 'EPIPE', 'ECONNREFUSED', 'ETIMEDOUT'].includes(code)
    || (typeof code === 'string' && /^(08|57P0[123])/.test(code))
    || /Connection terminated|server closed the connection|timeout exceeded when trying to connect/i.test(error?.message || '');
}
