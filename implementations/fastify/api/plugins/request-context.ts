import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

export const CORRELATION_HEADER = 'x-correlation-id';

/**
 * Request decorators used by every route. Wrapped with fastify-plugin so the
 * decorators and the onRequest hook escape this plugin's encapsulation
 * context and apply to the whole server.
 */
async function requestContext(fastify: FastifyInstance): Promise<void> {
  fastify.decorateRequest('correlationId', '');
  fastify.decorateRequest('viewer', null);
  fastify.addHook('onRequest', async (request, reply) => {
    // request.id comes from genReqId, which validates x-correlation-id.
    request.correlationId = request.id;
    reply.header(CORRELATION_HEADER, request.id);
  });
}

export const requestContextPlugin = fp(requestContext, { name: 'ofl-request-context', fastify: '5.x' });
