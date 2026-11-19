import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'drizzle-kit';
import { loadEnv } from './src/env.js';

loadEnv();

function caForKit(): { ca: string; rejectUnauthorized: true } | undefined {
  const raw = process.env.DATABASE_CA_PATH?.trim();
  if (!raw) return undefined;
  const absolute = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
  const stat = fs.statSync(absolute);
  const file = stat.isDirectory() ? path.join(absolute, 'ca.pem') : absolute;
  return { ca: fs.readFileSync(file, 'utf8'), rejectUnauthorized: true };
}

const url = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL or DATABASE_URL_DIRECT is required');

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url,
    ssl: caForKit(),
  },
  verbose: true,
  strict: true,
});
