import { loadConfig, type AppConfig, type Services } from '@ofl/server-core';
import type { AddressInfo } from 'node:net';
import { createNestApp } from '../api/create-app';
import { DEFAULT_RATE_LIMITS, type AppOptions } from '../api/options';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://shohelshamim@localhost:5432/ofl_nestjs_test';
export const WEB_ORIGIN = 'http://localhost:9012';

/** Rate limits high enough for a full suite run from 127.0.0.1. Production defaults are unchanged. */
export const TEST_RATE_LIMITS = { loginPerMinute: 1000, graphqlPerMinute: 100_000, webhookPerMinute: 10_000 };

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    ELASTICSEARCH_URL: process.env.ELASTICSEARCH_URL ?? 'http://127.0.0.1:9200',
    ES_INDEX_PREFIX: 'ofl_nestjs_test_',
    PAYMENT_WEBHOOK_SECRET: 'nestjs-test-webhook-secret',
    ENABLE_QUERY_COUNT: 'true',
    LOG_LEVEL: 'silent',
    ...overrides,
  });
}

export type TestServer = { services: Services; baseUrl: string; wsUrl: string; url(path: string): string; stop(): Promise<void> };

/** The real Nest app on an ephemeral port. stop() runs app.close() (all shutdown hooks) and is idempotent. */
export async function startTestServer(config: AppConfig, options: Partial<AppOptions> = {}): Promise<TestServer> {
  const { app, services } = await createNestApp(config, {
    allowedOrigins: [WEB_ORIGIN],
    rateLimits: TEST_RATE_LIMITS,
    staticDir: null,
    ...options,
  });
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  let stopped: Promise<void> | null = null;
  return {
    services,
    baseUrl,
    wsUrl: `ws://127.0.0.1:${port}/graphql`,
    url: (path) => new URL(path, baseUrl).toString(),
    stop: () => (stopped ??= app.close()),
  };
}

export { DEFAULT_RATE_LIMITS };

export const CSRF = { 'x-ofl-csrf': '1' } as const;
export const JSON_CSRF = { 'content-type': 'application/json', ...CSRF } as const;
