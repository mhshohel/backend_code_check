import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Next.js loads .env itself; the realtime service and the worker are plain
 * Node processes, so they load the same file. Variables already set in the
 * environment win (process.loadEnvFile does not overwrite them).
 */
/**
 * Interface for the realtime service and the worker health server. Loopback
 * by default so neither is reachable from other machines unless HOST says so
 * (for example HOST=0.0.0.0 inside a container behind a proxy).
 */
export function listenHost(env: Record<string, string | undefined> = process.env): string {
  return env.HOST?.trim() || '127.0.0.1';
}

export function loadDotEnv(cwd: string = process.cwd()): void {
  const path = resolve(cwd, '.env');
  if (existsSync(path)) process.loadEnvFile(path);
}
