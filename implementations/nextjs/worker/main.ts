import { createServer } from 'node:http';
import { hostname } from 'node:os';
import {
  checkLiveness,
  checkReadiness,
  closeServices,
  createServices,
  loadConfig,
  startWorker,
  type Services,
} from '@ofl/server-core';
import { listenHost, loadDotEnv } from '../modules/process/env';
import { onShutdownSignal } from '../modules/process/shutdown';

// Outbox worker for the Next.js variant: payment authorization, reservation
// expiry, refunds, search indexing. Health and metrics on WORKER_HEALTH_PORT (4302).

function startHealthServer(services: Services, port: number, host: string) {
  const server = createServer((request, response) => {
    const send = (status: number, body: string, contentType = 'application/json') => {
      response.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-store' });
      response.end(body);
    };
    if (request.method !== 'GET') return send(405, JSON.stringify({ error: 'Method not allowed.' }));
    if (request.url === '/health/live') return send(200, JSON.stringify(checkLiveness()));
    if (request.url === '/health/ready') {
      checkReadiness(services)
        .then((readiness) => send(readiness.ok ? 200 : 503, JSON.stringify(readiness)))
        .catch(() => send(503, JSON.stringify({ ok: false })));
      return;
    }
    if (request.url === '/metrics') {
      services.metrics
        .render()
        .then((text) => send(200, text, 'text/plain; version=0.0.4; charset=utf-8'))
        .catch(() => send(500, JSON.stringify({ error: 'Metrics unavailable.' })));
      return;
    }
    send(404, JSON.stringify({ error: 'Not found.' }));
  });
  server.listen(port, host);
  return server;
}

async function main(): Promise<void> {
  loadDotEnv();
  const services = await createServices(loadConfig(process.env), { role: 'worker' });
  const workerId = `nextjs-worker-${hostname()}-${process.pid}`;
  const worker = startWorker(services, { workerId });
  const healthPort = Number(process.env.WORKER_HEALTH_PORT ?? 4302);
  const host = listenHost();
  const health = startHealthServer(services, healthPort, host);
  services.logger.info({ workerId, healthPort, host }, 'worker started');

  onShutdownSignal(async () => {
    // Stop claiming new jobs and finish in-flight ones before closing the pool.
    await worker.stop();
    await new Promise<void>((resolve) => health.close(() => resolve()));
    await closeServices(services);
  });
}

main().catch((error: unknown) => {
  console.error('worker failed to start', error);
  process.exit(1);
});
