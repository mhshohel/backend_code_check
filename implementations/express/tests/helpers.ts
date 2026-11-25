import { closeServices, createServices, loadConfig, type AppConfig, type Services } from '@ofl/server-core';
import { startHttpServer, type RunningServer, type StartOptions } from '../api/http-server';
import { DEFAULT_RATE_LIMITS } from '../api/options';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://shohelshamim@localhost:5432/ofl_express_test';
export const WEB_ORIGIN = 'http://localhost:4101';

/** Rate limits high enough for a full suite run from 127.0.0.1. Production defaults are unchanged. */
export const TEST_RATE_LIMITS = { loginPerMinute: 1000, graphqlPerMinute: 100_000, webhookPerMinute: 10_000 };

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    ELASTICSEARCH_URL: process.env.ELASTICSEARCH_URL ?? 'http://127.0.0.1:9200',
    ES_INDEX_PREFIX: 'ofl_express_test_',
    PAYMENT_WEBHOOK_SECRET: 'express-test-webhook-secret',
    ENABLE_QUERY_COUNT: 'true',
    LOG_LEVEL: 'silent',
    ...overrides,
  });
}

export type TestServer = { services: Services; running: RunningServer; url(path: string): string; stop(): Promise<void> };

/** Real HTTP server on an ephemeral port (listen(0)) with its own Services. stop() is idempotent. */
export async function startTestServer(config: AppConfig, options: Partial<StartOptions> = {}): Promise<TestServer> {
  const services = await createServices(config, { role: 'api' });
  const running = await startHttpServer(services, {
    port: 0,
    allowedOrigins: [WEB_ORIGIN],
    rateLimits: TEST_RATE_LIMITS,
    staticDir: null,
    ...options,
  });
  let stopped: Promise<void> | null = null;
  return {
    services,
    running,
    url: (path) => new URL(path, running.baseUrl).toString(),
    stop: () =>
      (stopped ??= (async () => {
        await running.stop();
        await closeServices(services);
      })()),
  };
}

export { DEFAULT_RATE_LIMITS };

export const CSRF = { 'x-ofl-csrf': '1' } as const;
export const JSON_CSRF = { 'content-type': 'application/json', ...CSRF } as const;
