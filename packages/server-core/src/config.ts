import { z } from 'zod';

const booleanFlag = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((value) => value === 'true' || value === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required.'),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).max(600_000).default(5000),
  ELASTICSEARCH_URL: z.url().default('http://127.0.0.1:9200'),
  ES_INDEX_PREFIX: z
    .string()
    .regex(/^[a-z0-9_]+$/, 'Use lowercase letters, digits, and underscores.')
    .default('ofl_dev_'),
  RESERVATION_TTL_SECONDS: z.coerce.number().int().min(1).max(86_400).default(900),
  SESSION_TTL_SECONDS: z.coerce.number().int().min(60).max(30 * 86_400).default(8 * 3600),
  PAYMENT_WEBHOOK_SECRET: z.string().min(16, 'PAYMENT_WEBHOOK_SECRET needs at least 16 characters.').default('dev-webhook-secret-change-me'),
  ENABLE_QUERY_COUNT: booleanFlag,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  databaseUrl: string;
  dbPoolMax: number;
  statementTimeoutMs: number;
  elasticsearchUrl: string;
  esIndexPrefix: string;
  reservationTtlSeconds: number;
  sessionTtlSeconds: number;
  paymentWebhookSecret: string;
  enableQueryCount: boolean;
  logLevel: string;
};

/** Parses and validates the environment. Throws one readable error listing every problem. */
export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const result = envSchema.safeParse(stripEmpty(env));
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid configuration:\n  ${problems.join('\n  ')}`);
  }
  const parsed = result.data;
  if (parsed.NODE_ENV === 'production' && parsed.PAYMENT_WEBHOOK_SECRET === 'dev-webhook-secret-change-me') {
    throw new Error('Invalid configuration:\n  PAYMENT_WEBHOOK_SECRET must be set in production.');
  }
  return {
    nodeEnv: parsed.NODE_ENV,
    databaseUrl: parsed.DATABASE_URL,
    dbPoolMax: parsed.DB_POOL_MAX,
    statementTimeoutMs: parsed.STATEMENT_TIMEOUT_MS,
    elasticsearchUrl: parsed.ELASTICSEARCH_URL,
    esIndexPrefix: parsed.ES_INDEX_PREFIX,
    reservationTtlSeconds: parsed.RESERVATION_TTL_SECONDS,
    sessionTtlSeconds: parsed.SESSION_TTL_SECONDS,
    paymentWebhookSecret: parsed.PAYMENT_WEBHOOK_SECRET,
    enableQueryCount: parsed.ENABLE_QUERY_COUNT,
    logLevel: parsed.LOG_LEVEL,
  };
}

// An empty variable in .env means "not set", so defaults apply.
function stripEmpty(env: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && value !== '') result[key] = value;
  }
  return result;
}
