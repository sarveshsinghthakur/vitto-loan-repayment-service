import { loadEnv } from '../lib/env.js';
import { getPool, closePool } from '../lib/db.js';
import { runMigrations } from '../lib/schema.js';

loadEnv();

const pool = getPool();
await runMigrations(pool);
console.log('Database schema is up to date.');
await closePool();
