import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** implementations/express, from both api/*.ts (tsx) and dist/*.js (esbuild bundle). */
export const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Loads implementations/express/.env when present; real environment variables win. */
export function loadVariantEnv(): void {
  const file = `${PACKAGE_ROOT}.env`;
  if (existsSync(file)) process.loadEnvFile(file);
}

function intFrom(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) throw new Error(`${name} must be a port number, got "${value}".`);
  return parsed;
}

export type ExpressSettings = {
  port: number;
  host: string;
  workerHealthPort: number;
  allowedOrigins: string[];
  staticDir: string | null;
};

/** Express-specific settings; shared settings come from server-core's loadConfig. */
export function loadExpressSettings(env: NodeJS.ProcessEnv, production: boolean): ExpressSettings {
  const webDist = fileURLToPath(new URL('../web/dist', import.meta.url));
  return {
    port: intFrom(env.PORT, 4100, 'PORT'),
    host: env.HOST || '127.0.0.1',
    workerHealthPort: intFrom(env.WORKER_HEALTH_PORT, 4102, 'WORKER_HEALTH_PORT'),
    allowedOrigins: (env.WEB_ORIGINS || 'http://localhost:4101,http://localhost:4100')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    staticDir: production && existsSync(webDist) ? webDist : null,
  };
}
