// Starts the REAL paper router behind the REAL request-scoped database middleware, connected as the restricted application
// role. A test identity (headers) stands in for the A-Zee verifier, which is a separate integration.
import express from 'express';
import { config } from './cert.js';

export async function startApi() {
  process.env.DATABASE_URL = config.appUrl;
  process.env.AZTRADE_PAPER_EXECUTION_CERTIFIED = 'true';            // only inside the test process, never in .env
  const { requestDb } = await import('../../lib/request-db.js');
  const dbPool = (await import('../../lib/db.js')).default;
  const { default: paper } = await import('../../routes/paper.js');
  const app = express();
  app.use(express.json());
  const testAuth = (req, res, next) => { req.user = { id: req.get('x-test-user'), tenant_id: req.get('x-test-tenant') }; next(); };
  app.use('/api/paper', testAuth, requestDb, paper);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (u, method, path, body) => fetch(base + path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': u.userId, 'x-test-tenant': u.tenant },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
  const stop = async () => { await new Promise(r => server.close(r)); await dbPool.end().catch(() => {}); };
  return { base, call, stop, dbPool };
}
