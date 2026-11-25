import { hostname } from 'node:os';
import { checkLiveness, checkReadiness, closeServices, createServices, loadConfig, startWorker } from '@ofl/server-core';
import Fastify from 'fastify';
import { loadDotEnv } from '../api/load-env';

loadDotEnv();
const config = loadConfig();
const services = await createServices(config, { role: 'worker' });
const worker = startWorker(services, { workerId: `fastify-${hostname()}-${process.pid}` });

// A tiny HTTP endpoint so an orchestrator can probe the worker and scrape metrics.
const health = Fastify({ logger: false });
health.get('/health/live', async () => checkLiveness());
health.get('/health/ready', async (_request, reply) => {
  const readiness = await checkReadiness(services);
  return reply.code(readiness.ok ? 200 : 503).send(readiness);
});
health.get('/metrics', async (_request, reply) => reply.type(services.metrics.contentType).send(await services.metrics.render()));

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  services.logger.info({ signal }, 'worker shutting down');
  await health.close();
  await worker.stop(); // finishes in-flight jobs first
  await closeServices(services);
  process.exit(0);
}
process.once('SIGTERM', (signal) => void shutdown(signal));
process.once('SIGINT', (signal) => void shutdown(signal));

await health.listen({ port: Number(process.env.WORKER_PORT ?? 9007), host: process.env.HOST ?? '127.0.0.1' });
services.logger.info('worker started');
