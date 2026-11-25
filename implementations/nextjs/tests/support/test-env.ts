// Requirements §11: Next.js tests use ofl_nextjs_test and the ofl_nextjs_test_ index prefix.
export const TEST_WEBHOOK_SECRET = 'nextjs-test-webhook-secret';

export function testEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://shohelshamim@localhost:5432/ofl_nextjs_test',
    ELASTICSEARCH_URL: process.env.ELASTICSEARCH_URL ?? 'http://127.0.0.1:9200',
    ES_INDEX_PREFIX: 'ofl_nextjs_test_',
    PAYMENT_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET,
    ENABLE_QUERY_COUNT: 'true',
    LOG_LEVEL: 'silent',
    DB_POOL_MAX: '20',
    RATE_LIMIT_DISABLED: 'true',
    NEXT_TELEMETRY_DISABLED: '1',
    ...overrides,
  };
}
