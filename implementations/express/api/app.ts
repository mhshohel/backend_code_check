import { buildGraphQLSchema, type Services } from '@ofl/server-core';
import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import type { GraphQLSchema } from 'graphql';
import { correlationId } from './middleware/correlation';
import { errorHandler, notFound } from './middleware/errors';
import { httpMetrics } from './middleware/http-metrics';
import { createRateLimiters } from './middleware/rate-limits';
import { corsAllowlist, securityHeaders } from './middleware/security';
import { sessionMiddleware } from './middleware/session';
import { defaultAppOptions, type AppOptions } from './options';
import { authRoutes } from './routes/auth';
import { graphqlRoutes } from './routes/graphql';
import { healthRoutes } from './routes/health';
import { spaRoutes } from './routes/static';
import { webhookRoutes } from './routes/webhooks';
import './types';

/**
 * Builds the Express application. Order matters and is the point of this file:
 *  1. correlation ID      — before anything can log
 *  2. metrics             — measures everything below
 *  3. helmet + CORS       — headers and preflight answers before any work
 *  4. health / metrics    — no session or rate limit (probes must not be throttled)
 *  5. webhook             — raw body, own rate limit, signature instead of cookie/CSRF
 *  6. cookies + session   — resolves the viewer once per /auth or /graphql request
 *  7. /auth, /graphql     — each with its rate limit, CSRF check and JSON body limit
 *  8. static SPA (prod)   — then 404 and the error handler last
 */
export type CreateAppOptions = Partial<AppOptions> & { schema?: GraphQLSchema };

export function createApp(services: Services, overrides: CreateAppOptions = {}): Express {
  const { schema = buildGraphQLSchema(services), ...rest } = overrides;
  const options = defaultAppOptions(rest);
  const app = express();
  const limiters = createRateLimiters(options.rateLimits);
  const production = services.config.nodeEnv === 'production';

  app.disable('x-powered-by');
  app.use(correlationId);
  app.use(httpMetrics(services));
  app.use(securityHeaders(production));
  app.use(corsAllowlist(options.allowedOrigins));

  app.use(healthRoutes(services));
  app.use('/webhooks', webhookRoutes(services, { limiter: limiters.webhook, bodyLimit: options.bodyLimit }));

  app.use(['/auth', '/graphql'], cookieParser(), sessionMiddleware(services));
  app.use('/auth', authRoutes(services, { loginLimiter: limiters.login, bodyLimit: options.bodyLimit }));
  app.use(graphqlRoutes(services, schema, { limiter: limiters.graphql, bodyLimit: options.bodyLimit }));

  if (options.staticDir) app.use(spaRoutes(options.staticDir));
  app.use(notFound);
  app.use(errorHandler(services));
  return app;
}
