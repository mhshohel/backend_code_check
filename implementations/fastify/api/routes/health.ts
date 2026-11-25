import { checkLiveness, checkReadiness } from '@ofl/server-core';
import type { FastifyInstance } from 'fastify';

/** Liveness, readiness (PostgreSQL + Elasticsearch), and Prometheus metrics. */
export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/health/live', async () => checkLiveness());

  fastify.get('/health/ready', async (_request, reply) => {
    const readiness = await checkReadiness(fastify.services);
    return reply.code(readiness.ok ? 200 : 503).send(readiness);
  });

  fastify.get('/metrics', async (_request, reply) => {
    const { metrics } = fastify.services;
    return reply.type(metrics.contentType).send(await metrics.render());
  });
}
