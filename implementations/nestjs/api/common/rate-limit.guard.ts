import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, RequestHandler, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { RateLimits } from '../options';
import { RATE_LIMITERS } from '../tokens';
import { ApiError } from './api-error';
import { RATE_LIMIT_KEY, type RateLimitBucket } from './decorators';

const WINDOW_MS = 60_000;
export type RateLimiters = Record<RateLimitBucket, RequestHandler>;

function limiter(limit: number, error: () => ApiError): RequestHandler {
  return rateLimit({
    windowMs: WINDOW_MS,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    // Hand the rejection back to the guard instead of writing a response here.
    handler: (_req, _res, next) => next(error()),
  });
}

/** One in-memory limiter per bucket; each API process counts on its own. */
export function createRateLimiters(limits: RateLimits): RateLimiters {
  return {
    login: limiter(limits.loginPerMinute, () => new ApiError(429, 'Too many sign-in attempts. Try again in a minute.')),
    graphql: limiter(limits.graphqlPerMinute, () => new ApiError(429, 'Too many requests. Try again in a minute.', 'RATE_LIMITED')),
    webhook: limiter(limits.webhookPerMinute, () => new ApiError(429, 'Too many webhook calls.')),
  };
}

/**
 * Applies the limiter named by @RateLimit(...). express-rate-limit does the
 * counting and sets the RateLimit / RateLimit-Policy headers; the guard only
 * adapts its middleware signature to Nest's canActivate.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(RATE_LIMITERS) private readonly limiters: RateLimiters,
  ) {}

  canActivate(context: ExecutionContext): Promise<boolean> | boolean {
    const bucket = this.reflector.getAllAndOverride<RateLimitBucket | undefined>(RATE_LIMIT_KEY, [context.getHandler(), context.getClass()]);
    if (!bucket) return true;
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    return new Promise((resolve, reject) => {
      void this.limiters[bucket](req, res, (error?: unknown) => (error ? reject(error) : resolve(true)));
    });
  }
}
