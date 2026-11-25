export type RateLimits = {
  loginPerMinute: number;
  graphqlPerMinute: number;
  webhookPerMinute: number;
};

export type BuildServerOptions = {
  /** Browser origins allowed by CORS and by the WebSocket Origin check. */
  allowedOrigins: readonly string[];
  rateLimits: RateLimits;
  /** Directory with the built SPA. Not served when undefined or missing. */
  webDistDir?: string;
};

export const PRODUCTION_RATE_LIMITS: RateLimits = { loginPerMinute: 10, graphqlPerMinute: 300, webhookPerMinute: 120 };

export const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:4201', 'http://localhost:4200'] as const;

export const BODY_LIMIT_BYTES = 100 * 1024;

export function resolveOptions(overrides: Partial<BuildServerOptions>): BuildServerOptions {
  return {
    allowedOrigins: overrides.allowedOrigins ?? DEFAULT_ALLOWED_ORIGINS,
    rateLimits: overrides.rateLimits ?? PRODUCTION_RATE_LIMITS,
    ...(overrides.webDistDir ? { webDistDir: overrides.webDistDir } : {}),
  };
}

/** Comma-separated env value, for example CORS_ORIGINS=http://localhost:4201,https://lab.example. */
export function parseOrigins(value: string | undefined): readonly string[] | undefined {
  const origins = value
    ?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return origins?.length ? origins : undefined;
}
