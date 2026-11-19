import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));

function findEnvFiles(): string[] {
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../../.env'),
    path.resolve(here, '../../../.env'),
  ];
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const p of candidates) {
    if (fs.existsSync(p) && !seen.has(p)) {
      seen.add(p);
      unique.push(p);
    }
  }
  return unique;
}

let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  const files = findEnvFiles();
  for (const file of files) loadDotenv({ path: file, quiet: true });
  loaded = true;
}
