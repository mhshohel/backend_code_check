import { resolveSession, SESSION_COOKIE_NAME, type RequestMeta } from '@ofl/server-core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { HttpError } from '../errors';

export const CSRF_HEADER = 'x-ofl-csrf';

/**
 * Hooks for the browser-facing API scope (auth + GraphQL). This function is
 * NOT wrapped with fastify-plugin: the hooks stay inside the encapsulation
 * context that registers it, so static files and the webhook never pay for
 * a session lookup or a CSRF check.
 */
export function addBrowserApiHooks(fastify: FastifyInstance): void {
  fastify.addHook('onRequest', async (request) => {
    request.viewer = await resolveSession(fastify.services, request.cookies[SESSION_COOKIE_NAME]);
  });
  // preValidation (not preHandler) so a request without the header is
  // rejected with 403 before schema validation can answer 400.
  fastify.addHook('preValidation', async (request) => {
    if (request.method === 'POST' && request.headers[CSRF_HEADER] !== '1') {
      throw new HttpError(403, 'CSRF_HEADER_MISSING', `State-changing requests need the ${CSRF_HEADER}: 1 header.`);
    }
  });
}

export function requestMeta(request: FastifyRequest): RequestMeta {
  return { correlationId: request.correlationId, ip: request.ip };
}
