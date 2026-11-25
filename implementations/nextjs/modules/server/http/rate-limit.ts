// Fixed-window, in-process rate limiter. Each Next.js process keeps its own
// counters, so N instances allow N times the configured rate. A shared store
// (PostgreSQL or Redis) would be needed for a hard global limit; for this lab
// the per-process limit is an accepted, documented tradeoff.

export type RateLimitRule = { readonly name: string; readonly limit: number; readonly windowMs: number };

export type RateLimitDecision = { readonly allowed: true } | { readonly allowed: false; readonly retryAfterSeconds: number };

type Window = { count: number; resetAt: number };

export const RATE_LIMITS = {
  login: { name: 'login', limit: 10, windowMs: 60_000 },
  graphql: { name: 'graphql', limit: 300, windowMs: 60_000 },
  webhook: { name: 'webhook', limit: 120, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitRule>;

const MAX_TRACKED_KEYS = 10_000;

export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, Window>();

  constructor(private readonly now: () => number = Date.now) {}

  consume(rule: RateLimitRule, clientKey: string): RateLimitDecision {
    const key = `${rule.name}:${clientKey}`;
    const now = this.now();
    let window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      this.evictExpired(now);
      window = { count: 0, resetAt: now + rule.windowMs };
      this.windows.set(key, window);
    }
    window.count += 1;
    if (window.count <= rule.limit) return { allowed: true };
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((window.resetAt - now) / 1000)) };
  }

  reset(): void {
    this.windows.clear();
  }

  private evictExpired(now: number): void {
    if (this.windows.size < MAX_TRACKED_KEYS) return;
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}

/** The acceptance suite fires many requests from one IP; it may disable limits, but only in tests. */
export function rateLimitingDisabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV === 'test' && env.RATE_LIMIT_DISABLED === 'true';
}

const LIMITER_KEY = Symbol.for('ofl.nextjs.rateLimiter');
type LimiterHolder = { [LIMITER_KEY]?: FixedWindowRateLimiter };

export function processRateLimiter(): FixedWindowRateLimiter {
  const holder = globalThis as typeof globalThis & LimiterHolder;
  holder[LIMITER_KEY] ??= new FixedWindowRateLimiter();
  return holder[LIMITER_KEY];
}

export function checkRateLimit(rule: RateLimitRule, clientKey: string): RateLimitDecision {
  if (rateLimitingDisabled()) return { allowed: true };
  return processRateLimiter().consume(rule, clientKey);
}
