import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Unexpected PG pool error', err);
});

export async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (process.env.NODE_ENV !== 'production') {
    console.log('query', { text: text.slice(0, 80), duration, rows: res.rowCount });
  }
  return res;
}

// A checked-out client that the server kills emits an 'error' event; with no listener Node treats it as an uncaught
// exception and the process dies. The pool listens only while a client is idle, so this adds a listener for the whole
// time the caller holds the client and removes it on release.
export async function getClient() {
  const client = await pool.connect();
  const onError = (err) => console.error('database connection error on a checked-out client', err.code || err.message);
  client.on('error', onError);
  const release = client.release.bind(client);
  client.release = (destroy) => { client.removeListener('error', onError); client.release = release; return release(destroy); };
  return client;
}

export default pool;
