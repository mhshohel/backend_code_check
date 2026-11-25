// Starts one variant's API for benchmarks, with rate limits raised so that
// the load generator measures the application, not the limiter. Production
// entry points keep their normal limits.
// Usage: tsx scripts/bench/serve.ts <express|fastify> <port>
import { closeServices, createServices, loadConfig } from '@ofl/server-core';

const BENCH_LIMITS = { loginPerMinute: 1_000_000, graphqlPerMinute: 1_000_000, webhookPerMinute: 1_000_000 };

const [variant, portText] = process.argv.slice(2);
const port = Number(portText);
if ((variant !== 'express' && variant !== 'fastify') || !Number.isInteger(port)) {
  throw new Error('Usage: serve.ts <express|fastify> <port>');
}

const services = await createServices(loadConfig(process.env), { role: 'api' });
let stop: () => Promise<void>;

if (variant === 'express') {
  const { startHttpServer } = await import('../../implementations/express/api/http-server');
  const running = await startHttpServer(services, { port, host: '127.0.0.1', rateLimits: BENCH_LIMITS });
  stop = async () => {
    await running.stop();
    await closeServices(services);
  };
} else {
  const { buildServer } = await import('../../implementations/fastify/api/build-server');
  const server = await buildServer(services, { rateLimits: BENCH_LIMITS });
  await server.listen({ port, host: '127.0.0.1' });
  stop = () => server.close(); // onClose closes the services
}

process.once('SIGTERM', () => {
  void stop().then(() => process.exit(0));
});
console.warn(`bench ${variant} listening on ${port}`);
