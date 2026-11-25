import websocket from '@fastify/websocket';
import { correlationIdFrom, type Services } from '@ofl/server-core';
import Fastify, { type FastifyInstance } from 'fastify';
import './fastify-augment';
import { registerErrorHandlers } from './errors';
import { BODY_LIMIT_BYTES, resolveOptions, type BuildServerOptions } from './options';
import { addBrowserApiHooks } from './plugins/api-scope';
import { metricsPlugin } from './plugins/metrics';
import { CORRELATION_HEADER, requestContextPlugin } from './plugins/request-context';
import { securityPlugin } from './plugins/security';
import { applicationServicesPlugin } from './plugins/services';
import { authRoutes } from './routes/auth';
import { graphqlRoutes } from './routes/graphql';
import { healthRoutes } from './routes/health';
import { spaRoutes } from './routes/spa';
import { webhookRoutes } from './routes/webhook';

const LOG_REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-ofl-signature"]',
  'res.headers["set-cookie"]',
  '*.email',
  '*.password',
  '*.token',
];

/**
 * Builds the Fastify server around existing services. The server owns the
 * services from here on: fastify.close() closes them (onClose hook).
 *
 * Plugin tree (encapsulation contexts):
 *   root: services, request context, security, metrics, websocket, health
 *   ├─ browser API scope: session onRequest + CSRF preHandler
 *   │   ├─ /auth   (login, logout)
 *   │   └─ /graphql (Yoga HTTP + graphql-ws)
 *   ├─ /webhooks scope: raw-body JSON parser, signature check in server-core
 *   └─ SPA static files + not-found fallback
 */
export async function buildServer(services: Services, overrides: Partial<BuildServerOptions> = {}): Promise<FastifyInstance> {
  const options = resolveOptions(overrides);
  const fastify = Fastify({
    logger: { level: services.config.logLevel, redact: { paths: LOG_REDACT_PATHS, censor: '[redacted]' } },
    bodyLimit: BODY_LIMIT_BYTES,
    genReqId: (request) => correlationIdFrom(headerValue(request.headers[CORRELATION_HEADER])),
    trustProxy: false,
  });

  registerErrorHandlers(fastify);
  await fastify.register(applicationServicesPlugin, { services });
  await fastify.register(requestContextPlugin);
  await fastify.register(securityPlugin, { allowedOrigins: options.allowedOrigins });
  await fastify.register(metricsPlugin);
  await fastify.register(websocket, { options: { maxPayload: BODY_LIMIT_BYTES } });
  await fastify.register(healthRoutes);

  await fastify.register(async (browserApi) => {
    addBrowserApiHooks(browserApi);
    await browserApi.register(authRoutes, { prefix: '/auth', loginPerMinute: options.rateLimits.loginPerMinute });
    await browserApi.register(graphqlRoutes, {
      graphqlPerMinute: options.rateLimits.graphqlPerMinute,
      allowedOrigins: options.allowedOrigins,
    });
  });
  await fastify.register(webhookRoutes, { prefix: '/webhooks', webhookPerMinute: options.rateLimits.webhookPerMinute });
  await fastify.register(spaRoutes, { webDistDir: options.webDistDir });

  return fastify;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
