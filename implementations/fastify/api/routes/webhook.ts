import { handlePaymentWebhook } from '@ofl/server-core';
import type { FastifyInstance } from 'fastify';
import { requestMeta } from '../plugins/api-scope';

// Only the header is described here. The body is deliberately not parsed or
// schema-validated by Fastify: an unsigned request must get 401 and learn
// nothing about the body format, so server-core verifies the HMAC first and
// validates the body only after that.
const webhookSchema = {
  headers: {
    type: 'object',
    properties: { 'x-ofl-signature': { type: 'string', maxLength: 200 } },
  },
} as const;

export type WebhookRouteOptions = { webhookPerMinute: number };

/**
 * POST /webhooks/payments. The HMAC covers the exact bytes the provider sent,
 * so this scope replaces the JSON parser with one that keeps the raw string
 * unparsed. The replacement only applies inside this encapsulation context.
 */
export async function webhookRoutes(fastify: FastifyInstance, options: WebhookRouteOptions): Promise<void> {
  fastify.decorateRequest('rawBody', '');
  fastify.removeContentTypeParser('application/json');
  fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    request.rawBody = typeof body === 'string' ? body : body.toString('utf8');
    done(null, undefined);
  });

  fastify.post(
    '/payments',
    { schema: webhookSchema, config: { rateLimit: { max: options.webhookPerMinute, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const signature = request.headers['x-ofl-signature'];
      const result = await handlePaymentWebhook(
        fastify.services,
        request.rawBody,
        typeof signature === 'string' ? signature : undefined,
        requestMeta(request),
      );
      return reply.code(result.status).send(result.body);
    },
  );
}
