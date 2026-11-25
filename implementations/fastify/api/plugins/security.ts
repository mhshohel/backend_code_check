import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { HttpError } from '../errors';

export type SecurityOptions = { allowedOrigins: readonly string[] };

/**
 * Security headers, CORS allowlist, cookie parsing, and the rate limiter.
 * The limiter is registered with global: false; each route opts in with
 * `config.rateLimit`, so limits are visible next to the route definition.
 */
async function security(fastify: FastifyInstance, options: SecurityOptions): Promise<void> {
  await fastify.register(helmet, {
    contentSecurityPolicy: {
      directives: { 'connect-src': ["'self'", 'ws:', 'wss:'] },
    },
  });
  await fastify.register(cors, {
    origin: [...options.allowedOrigins],
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['content-type', 'x-ofl-csrf', 'x-correlation-id', 'x-ofl-debug-query-count'],
    exposedHeaders: ['x-correlation-id'],
  });
  await fastify.register(cookie);
  await fastify.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_request, context) =>
      new HttpError(context.statusCode, 'RATE_LIMITED', `Too many requests. Retry in ${context.after}.`),
  });
}

export const securityPlugin = fp(security, { name: 'ofl-security' });
