import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client.js';
import { loadEnv } from './env.js';

loadEnv();

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(here, '../drizzle');
const connectionString = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL ?? undefined;

if (!connectionString) throw new Error('DATABASE_URL or DATABASE_URL_DIRECT is required');

const { db, pool } = createDb(connectionString);

try {
  await migrate(db, { migrationsFolder });
  console.log('migrations applied');
} finally {
  await pool.end();
}
