import type { AddressInfo } from 'node:net';
import { createServices, loadConfig, type AppConfig } from '@ofl/server-core';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../../api/build-server';
import type { BuildServerOptions } from '../../api/options';

export const TEST_WEBHOOK_SECRET = 'fastify-test-webhook-secret';
export const TEST_WEB_ORIGIN = 'http://localhost:4201';

/** Requirements §11: Fastify tests use ofl_fastify_test and the ofl_fastify_test_ index prefix. */
export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://shohelshamim@localhost:5432/ofl_fastify_test',
    ELASTICSEARCH_URL: process.env.ELASTICSEARCH_URL ?? 'http://127.0.0.1:9200',
    ES_INDEX_PREFIX: 'ofl_fastify_test_',
    PAYMENT_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
    ENABLE_QUERY_COUNT: 'true',
    LOG_LEVEL: 'silent',
    DB_POOL_MAX: '20',
    ...overrides,
  });
}

/** Limits high enough for the acceptance suite; dedicated tests pass their own. */
export const RELAXED_RATE_LIMITS = { loginPerMinute: 1000, graphqlPerMinute: 100_000, webhookPerMinute: 10_000 };

export type RunningServer = { server: FastifyInstance; baseUrl: string; wsUrl: string; stop(): Promise<void> };

export async function startServer(
  config: AppConfig,
  options: Partial<BuildServerOptions> = {},
): Promise<RunningServer> {
  const services = await createServices(config, { role: 'api' });
  const server = await buildServer(services, {
    allowedOrigins: [TEST_WEB_ORIGIN],
    rateLimits: RELAXED_RATE_LIMITS,
    ...options,
  });
  await server.listen({ port: 0, host: '127.0.0.1' });
  const { port } = server.server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/graphql`,
    stop: () => server.close(),
  };
}
