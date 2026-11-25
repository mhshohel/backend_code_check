import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export type ErrorBody = { error: string; code: string; correlationId: string };

/** An expected HTTP failure with a status code and a stable machine-readable code. */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

const CODE_BY_STATUS: Readonly<Record<number, string>> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'RATE_LIMITED',
};

function statusOf(error: FastifyError | HttpError): number {
  const status = error.statusCode ?? 500;
  return status >= 400 && status < 600 ? status : 500;
}

/**
 * One JSON error format for every non-GraphQL route. GraphQL errors use the
 * GraphQL response format instead (Yoga handles those). Internal errors never
 * leak their message.
 */
export function registerErrorHandlers(fastify: FastifyInstance): void {
  fastify.setErrorHandler((error: FastifyError | HttpError, request: FastifyRequest, reply: FastifyReply) => {
    const status = statusOf(error);
    if (status >= 500) request.log.error({ err: error }, 'request failed');
    const code = error instanceof HttpError ? error.code : (CODE_BY_STATUS[status] ?? 'INTERNAL_SERVER_ERROR');
    const message = status >= 500 ? 'Internal server error.' : error.message;
    const body: ErrorBody = { error: message, code, correlationId: request.correlationId };
    return reply.code(status).send(body);
  });
}

export function notFoundBody(request: FastifyRequest): ErrorBody {
  return { error: `Route ${request.method} ${request.url} not found.`, code: 'NOT_FOUND', correlationId: request.correlationId };
}
