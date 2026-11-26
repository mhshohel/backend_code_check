import { Controller, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import { handlePaymentWebhook, type Services } from '@ofl/server-core';
import type { Request, Response } from 'express';
import { RateLimit } from '../common/decorators';
import { RateLimitGuard } from '../common/rate-limit.guard';
import { requestMeta } from '../common/request-meta';
import { SERVICES } from '../tokens';

/**
 * POST /webhooks/payments. RawBodyMiddleware keeps the exact bytes for the
 * HMAC. No CsrfGuard and no session middleware are bound to this controller:
 * the provider authenticates with the signature.
 */
@Controller('webhooks')
@UseGuards(RateLimitGuard)
@RateLimit('webhook')
export class WebhooksController {
  constructor(@Inject(SERVICES) private readonly services: Services) {}

  @Post('payments')
  async payments(@Req() req: Request, @Res() res: Response): Promise<void> {
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    const result = await handlePaymentWebhook(this.services, rawBody, req.get('x-ofl-signature'), requestMeta(req, res));
    res.status(result.status).json(result.body);
  }
}
