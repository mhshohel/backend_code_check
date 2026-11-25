import { handlePaymentWebhook, type Services } from '@ofl/server-core';
import express, { Router, type RequestHandler } from 'express';
import { requestMeta } from '../request-meta';

/**
 * POST /webhooks/payments. The HMAC covers the exact bytes sent, so this
 * route reads the raw body (express.raw) instead of parsed JSON. No CSRF
 * header and no session: the provider authenticates with the signature.
 */
export function webhookRoutes(services: Services, options: { limiter: RequestHandler; bodyLimit: string }): Router {
  const router = Router();
  router.post('/payments', options.limiter, express.raw({ type: () => true, limit: options.bodyLimit }), async (req, res) => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    const result = await handlePaymentWebhook(services, rawBody, req.get('x-ofl-signature'), requestMeta(req, res));
    res.status(result.status).json(result.body);
  });
  return router;
}
