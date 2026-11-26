import type { Services } from '@ofl/server-core';
import type { RequestHandler } from 'express';

const KNOWN_ROUTES = ['/graphql', '/auth/login', '/auth/logout', '/webhooks/payments', '/health/live', '/health/ready', '/metrics'];

// A fixed label set keeps the metric's cardinality bounded (no IDs or query strings).
function routeLabel(path: string): string {
  return KNOWN_ROUTES.find((route) => path === route) ?? (path.startsWith('/assets/') ? '/assets' : 'other');
}

/**
 * One histogram observation and one structured access-log line per response.
 * Plain Express middleware (app.use) rather than a Nest interceptor: an
 * interceptor runs only for requests that reach a handler, so it would miss
 * CORS preflights, 404s, body-parser errors and guard rejections.
 */
export function httpMetrics(services: Services): RequestHandler {
  return (req, res, next) => {
    const started = performance.now();
    res.on('finish', () => {
      const path = new URL(req.originalUrl, 'http://localhost').pathname;
      const observation = {
        method: req.method,
        route: routeLabel(path),
        status: res.statusCode,
        durationMs: Math.round((performance.now() - started) * 10) / 10,
      };
      services.metrics.observeHttp(observation);
      const level = path.startsWith('/health') ? 'debug' : 'info';
      services.logger[level]({ ...observation, correlationId: res.locals.correlationId }, 'request completed');
    });
    next();
  };
}
