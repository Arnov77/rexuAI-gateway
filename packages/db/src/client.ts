import fs from 'node:fs';
import path from 'node:path';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import pg from 'pg';
import { loadEnv } from './env.js';
import * as schema from './schema/index.js';

loadEnv();

export type Database = NodePgDatabase<typeof schema>;

const { Pool: PgPool } = pg;

function normalizeConnectionString(url?: string): string | undefined {
  if (!url) return url;
  const parsed = new URL(url);
  parsed.searchParams.delete('sslmode');
  parsed.searchParams.delete('sslrootcert');
  return parsed.toString();
}

export function resolveCaPath(): string | undefined {
  const raw = process.env.DATABASE_CA_PATH?.trim();
  if (!raw) return undefined;

  const absolute = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
  if (!fs.existsSync(absolute)) {
    throw new Error(`DATABASE_CA_PATH does not exist: ${absolute}`);
  }

  const stat = fs.statSync(absolute);
  if (stat.isDirectory()) {
    const file = path.join(absolute, 'ca.pem');
    if (!fs.existsSync(file)) {
      throw new Error(`CA bundle not found in DATABASE_CA_PATH directory: ${file}`);
    }
    return file;
  }

  return absolute;
}

export function createPool(rawUrl = process.env.DATABASE_URL, max = 10): Pool {
  if (!rawUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const connectionString = normalizeConnectionString(rawUrl);
  const caPath = resolveCaPath();
  return new PgPool({
    connectionString,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'rexu',
    ...(caPath
      ? {
          ssl: {
            rejectUnauthorized: true,
            ca: fs.readFileSync(caPath, 'utf8'),
          },
        }
      : {}),
  });
}

export function createDb(connectionString = process.env.DATABASE_URL): {
  db: Database;
  pool: Pool;
} {
  const pool = createPool(connectionString);
  return { db: drizzle(pool, { schema }), pool };
}

let cached: { db: Database; pool: Pool } | null = null;

export function getDb(): Database {
  cached ??= createDb();
  return cached.db;
}

export function getPool(): Pool {
  cached ??= createDb();
  return cached.pool;
}

export async function closeDb(): Promise<void> {
  if (!cached) return;
  const { pool } = cached;
  cached = null;
  await pool.end();
}
