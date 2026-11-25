import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

/** HTTP latency histogram. Global (fastify-plugin) so it sees every route. */
async function httpMetrics(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('onResponse', async (request, reply) => {
    fastify.services.metrics.observeHttp({
      method: request.method,
      // The route pattern, not the URL, keeps label cardinality bounded.
      route: request.routeOptions.url ?? 'unmatched',
      status: reply.statusCode,
      durationMs: reply.elapsedTime,
    });
  });
}

export const metricsPlugin = fp(httpMetrics, { name: 'ofl-http-metrics', dependencies: ['ofl-services'] });
