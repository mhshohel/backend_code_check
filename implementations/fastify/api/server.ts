import { resolve } from 'node:path';
import { createServices, loadConfig } from '@ofl/server-core';
import { buildServer } from './build-server';
import { loadDotEnv } from './load-env';
import { parseOrigins } from './options';

loadDotEnv();
const config = loadConfig();
const services = await createServices(config, { role: 'api' });
const server = await buildServer(services, {
  allowedOrigins: parseOrigins(process.env.CORS_ORIGINS),
  webDistDir: resolve(process.env.WEB_DIST_DIR ?? 'web/dist'),
});

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  server.log.info({ signal }, 'shutting down');
  // close() stops accepting connections, waits for in-flight requests,
  // then runs onClose hooks (graphql-ws dispose, closeServices).
  await server.close();
  process.exit(0);
}
process.once('SIGTERM', (signal) => void shutdown(signal));
process.once('SIGINT', (signal) => void shutdown(signal));

await server.listen({ port: Number(process.env.PORT ?? 9005), host: process.env.HOST ?? '127.0.0.1' });
