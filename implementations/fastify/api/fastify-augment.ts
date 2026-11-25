// Type declarations for the decorators this server adds. Fastify decorators
// are runtime properties, so TypeScript learns about them through
// declaration merging.
import type { Services, SessionUser } from '@ofl/server-core';

declare module 'fastify' {
  interface FastifyInstance {
    services: Services;
  }
  interface FastifyRequest {
    /** Copied from a valid `x-correlation-id` header or generated (see genReqId). */
    correlationId: string;
    /** Signed-in user, resolved by the session hook in the API scope. */
    viewer: SessionUser | null;
    /** Raw webhook body, captured by the webhook scope's content type parser. */
    rawBody: string;
  }
}

export {};
