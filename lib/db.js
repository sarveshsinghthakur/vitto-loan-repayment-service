import pg from 'pg';

const { Pool } = pg;

// Return DATE columns as plain 'YYYY-MM-DD' strings so schedule comparisons
// are timezone-independent (the default parser builds a local-time Date).
pg.types.setTypeParser(1082, (value) => value);

let pool = null;

export function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set');
    }
    const useSsl =
      process.env.DATABASE_SSL === 'true' ||
      /sslmode=require/i.test(connectionString);
    pool = new Pool({
      connectionString,
      ssl: useSsl ? { rejectUnauthorized: false } : false,
      max: 10,
    });
  }
  return pool;
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
