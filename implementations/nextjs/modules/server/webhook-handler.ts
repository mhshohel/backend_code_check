import 'server-only';
import { handlePaymentWebhook, type RequestMeta } from '@ofl/server-core';
import { getServices } from './services';
import { PRIVATE_NO_STORE, assertRateLimit, assertSameOrigin, readBodyWithLimit } from './http/guards';
import { RATE_LIMITS } from './http/rate-limit';

/**
 * POST /api/webhooks/payments. The HMAC signature covers the exact bytes, so
 * the body is read as raw text and never re-serialized. No CSRF header: the
 * provider is not a browser, and the signature authenticates the caller.
 */
export async function handleWebhookRequest(request: Request, meta: RequestMeta): Promise<Response> {
  assertSameOrigin(request);
  assertRateLimit(request, RATE_LIMITS.webhook);
  const rawBody = await readBodyWithLimit(request);
  const services = await getServices();
  const result = await handlePaymentWebhook(services, rawBody, request.headers.get('x-ofl-signature') ?? undefined, meta);
  return Response.json(result.body, { status: result.status, headers: { 'Cache-Control': PRIVATE_NO_STORE } });
}
