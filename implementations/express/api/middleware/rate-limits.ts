import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { sendError, sendGraphQLError } from '../http-errors';
import type { RateLimits } from '../options';

const WINDOW_MS = 60_000;

function limiter(limit: number, onLimit: RequestHandler): RequestHandler {
  return rateLimit({ windowMs: WINDOW_MS, limit, standardHeaders: 'draft-8', legacyHeaders: false, handler: onLimit });
}

/** One in-memory limiter per route group; each API process counts on its own. */
export function createRateLimiters(limits: RateLimits) {
  return {
    login: limiter(limits.loginPerMinute, (_req, res) => sendError(res, 429, 'Too many sign-in attempts. Try again in a minute.')),
    graphql: limiter(limits.graphqlPerMinute, (_req, res) =>
      sendGraphQLError(res, 429, 'RATE_LIMITED', 'Too many requests. Try again in a minute.'),
    ),
    webhook: limiter(limits.webhookPerMinute, (_req, res) => sendError(res, 429, 'Too many webhook calls.')),
  };
}
