/** Limits per IP per minute. */
export type RateLimits = { loginPerMinute: number; graphqlPerMinute: number; webhookPerMinute: number };

export const DEFAULT_RATE_LIMITS: RateLimits = { loginPerMinute: 10, graphqlPerMinute: 300, webhookPerMinute: 120 };

export type AppOptions = {
  /** Browser origins allowed by CORS and the WebSocket origin check. */
  allowedOrigins: readonly string[];
  /** Production defaults; tests pass higher limits (the acceptance suite sends hundreds of requests). */
  rateLimits: RateLimits;
  /** Built SPA (web/dist) to serve with an index.html fallback; null disables static serving. */
  staticDir: string | null;
  bodyLimit: string;
};

export function defaultAppOptions(overrides: Partial<AppOptions> = {}): AppOptions {
  return {
    allowedOrigins: ['http://localhost:9002', 'http://localhost:9001'],
    rateLimits: DEFAULT_RATE_LIMITS,
    staticDir: null,
    bodyLimit: '100kb',
    ...overrides,
  };
}
