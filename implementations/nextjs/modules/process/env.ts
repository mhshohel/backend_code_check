import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Next.js loads .env itself; the realtime service and the worker are plain
 * Node processes, so they load the same file. Variables already set in the
 * environment win (process.loadEnvFile does not overwrite them).
 */
export function loadDotEnv(cwd: string = process.cwd()): void {
  const path = resolve(cwd, '.env');
  if (existsSync(path)) process.loadEnvFile(path);
}
