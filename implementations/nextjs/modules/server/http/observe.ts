import 'server-only';
import { getServices } from '../services';
import { CORRELATION_HEADER, requestMetaFrom } from './request-meta';
import type { RequestMeta } from '@ofl/server-core';

type RouteHandler = (request: Request, meta: RequestMeta) => Promise<Response>;

/**
 * Wraps a route handler: assigns the correlation ID, echoes it in the
 * response, and records the request in the Prometheus histogram. Unexpected
 * errors become a generic 500 so stack traces never reach the client.
 */
export function observed(route: string, handler: RouteHandler): (request: Request) => Promise<Response> {
  return async (request) => {
    const startedAt = performance.now();
    const meta = requestMetaFrom(request.headers);
    let response: Response;
    try {
      response = await handler(request, meta);
    } catch (error) {
      await logUnexpected(route, meta, error);
      response = Response.json({ error: 'Internal server error.' }, { status: 500 });
      response.headers.set('Cache-Control', 'no-store');
    }
    response.headers.set(CORRELATION_HEADER, meta.correlationId);
    await recordMetric(request.method, route, response.status, performance.now() - startedAt);
    return response;
  };
}

async function logUnexpected(route: string, meta: RequestMeta, error: unknown): Promise<void> {
  try {
    const services = await getServices();
    services.logger.error({ err: error, route, correlationId: meta.correlationId }, 'route handler failed');
  } catch {
    console.error('route handler failed', route, error);
  }
}

async function recordMetric(method: string, route: string, status: number, durationMs: number): Promise<void> {
  try {
    const services = await getServices();
    services.metrics.observeHttp({ method, route, status, durationMs });
  } catch {
    // Metrics are best effort; a missing services instance already produced an error response.
  }
}
