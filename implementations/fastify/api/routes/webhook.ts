import { handlePaymentWebhook } from '@ofl/server-core';
import type { FastifyInstance } from 'fastify';
import { HttpError } from '../errors';
import { requestMeta } from '../plugins/api-scope';

type PaymentWebhookBody = {
  providerEventId: string;
  paymentId: string;
  kind: 'PAYMENT_SUCCEEDED' | 'PAYMENT_DECLINED';
  amountMinor: number;
};

const webhookSchema = {
  headers: {
    type: 'object',
    properties: { 'x-ofl-signature': { type: 'string', maxLength: 200 } },
  },
  body: {
    type: 'object',
    required: ['providerEventId', 'paymentId', 'kind', 'amountMinor'],
    properties: {
      providerEventId: { type: 'string', minLength: 1, maxLength: 200 },
      paymentId: { type: 'string', minLength: 1, maxLength: 100 },
      kind: { type: 'string', enum: ['PAYMENT_SUCCEEDED', 'PAYMENT_DECLINED'] },
      amountMinor: { type: 'integer', minimum: 0 },
    },
  },
} as const;

export type WebhookRouteOptions = { webhookPerMinute: number };

/**
 * POST /webhooks/payments. The HMAC covers the exact bytes the provider sent,
 * so this scope replaces the JSON parser with one that keeps the raw string.
 * The replacement only applies inside this encapsulation context.
 */
export async function webhookRoutes(fastify: FastifyInstance, options: WebhookRouteOptions): Promise<void> {
  fastify.decorateRequest('rawBody', '');
  fastify.removeContentTypeParser('application/json');
  fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    const raw = typeof body === 'string' ? body : body.toString('utf8');
    request.rawBody = raw;
    try {
      done(null, JSON.parse(raw));
    } catch {
      done(new HttpError(400, 'BAD_REQUEST', 'Body is not valid JSON.'), undefined);
    }
  });

  fastify.post<{ Body: PaymentWebhookBody }>(
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
