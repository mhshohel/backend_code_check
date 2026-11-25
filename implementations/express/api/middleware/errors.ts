import { isAppError, type AppErrorCode } from '@ofl/domain';
import type { Services } from '@ofl/server-core';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { sendError } from '../http-errors';

type HttpLikeError = { status?: unknown; statusCode?: unknown; type?: unknown; expose?: unknown; message?: unknown };

function clientStatus(error: HttpLikeError): number | null {
  const status = typeof error.status === 'number' ? error.status : typeof error.statusCode === 'number' ? error.statusCode : null;
  return status !== null && status >= 400 && status < 500 ? status : null;
}

function clientMessage(error: HttpLikeError, status: number): string {
  if (error.type === 'entity.too.large') return 'Request body is too large (limit 100 KB).';
  if (error.type === 'entity.parse.failed') return 'Request body is not valid JSON.';
  if (error.expose === true && typeof error.message === 'string') return error.message;
  return status === 404 ? 'Not found.' : 'Bad request.';
}

const APP_ERROR_STATUS: Partial<Record<AppErrorCode, number>> = {
  BAD_USER_INPUT: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
};

export const notFound: RequestHandler = (_req, res) => sendError(res, 404, 'Not found.');

/** Last middleware. Client errors keep their status; anything else is a logged 500 without details. */
export function errorHandler(services: Services): ErrorRequestHandler {
  return (error: unknown, req, res, next) => {
    if (res.headersSent) return next(error);
    const appStatus = isAppError(error) ? APP_ERROR_STATUS[error.code] : undefined;
    if (isAppError(error) && appStatus !== undefined) return sendError(res, appStatus, error.message);
    const httpError: HttpLikeError = typeof error === 'object' && error !== null ? error : {};
    const status = clientStatus(httpError);
    if (status !== null) return sendError(res, status, clientMessage(httpError, status));
    services.logger.error({ err: error, correlationId: res.locals.correlationId, path: req.path }, 'unhandled request error');
    sendError(res, 500, 'Internal server error.');
  };
}
