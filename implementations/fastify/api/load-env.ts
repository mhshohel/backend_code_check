import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Loads `.env` from the working directory when present (Node's built-in loader). */
export function loadDotEnv(cwd = process.cwd()): void {
  const file = resolve(cwd, '.env');
  if (existsSync(file)) process.loadEnvFile(file);
}
