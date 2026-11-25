import { checkLiveness, checkReadiness, closeServices, createServices, loadConfig, startWorker, type Services } from '@ofl/server-core';
import express from 'express';
import { hostname } from 'node:os';
import { createServer, type Server } from 'node:http';
import { loadExpressSettings, loadVariantEnv } from '../api/env';
import { onShutdownSignal } from '../api/shutdown';

/** Small Express app for probes: the worker has no other HTTP surface. */
function healthApp(services: Services) {
  const app = express();
  app.disable('x-powered-by');
  app.get('/health/live', (_req, res) => {
    res.json(checkLiveness());
  });
  app.get('/health/ready', async (_req, res) => {
    const readiness = await checkReadiness(services);
    res.status(readiness.ok ? 200 : 503).json(readiness);
  });
  app.get('/metrics', async (_req, res) => {
    res.type(services.metrics.contentType).send(await services.metrics.render());
  });
  return app;
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });
}

async function main(): Promise<void> {
  loadVariantEnv();
  const config = loadConfig(process.env);
  const settings = loadExpressSettings(process.env, false);
  const services = await createServices(config, { role: 'worker' });
  const worker = startWorker(services, { workerId: `express-${hostname()}-${process.pid}` });
  const server = createServer(healthApp(services));
  await listen(server, settings.workerHealthPort, settings.host);
  services.logger.info({ port: settings.workerHealthPort }, 'express worker started');

  // Stop claiming jobs and finish in-flight ones, then close probes and services.
  onShutdownSignal(services.logger, async () => {
    await worker.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeServices(services);
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
