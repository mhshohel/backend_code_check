import { Catch, HttpException, Inject, NotFoundException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { isAppError, type AppErrorCode } from '@ofl/domain';
import type { Services } from '@ofl/server-core';
import type { Request, Response } from 'express';
import { join } from 'node:path';
import type { AppOptions } from '../options';
import { APP_OPTIONS, SERVICES } from '../tokens';
import { ApiError } from './api-error';

type HttpLikeError = { status?: unknown; statusCode?: unknown; type?: unknown; expose?: unknown; message?: unknown };

const APP_ERROR_STATUS: Partial<Record<AppErrorCode, number>> = {
  BAD_USER_INPUT: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
};

const API_PREFIXES = ['/graphql', '/auth', '/webhooks', '/health', '/metrics'];

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

/**
 * The one place that writes error responses (registered as APP_FILTER). It
 * sees errors from middleware, guards, handlers and Nest's own 404.
 * Non-GraphQL routes answer { error, correlationId }; guard errors on
 * /graphql answer in GraphQL shape. Anything unexpected is a logged 500
 * without details.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(
    @Inject(SERVICES) private readonly services: Services,
    @Inject(APP_OPTIONS) private readonly options: AppOptions,
  ) {}

  catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    if (res.headersSent) return;
    const correlationId = res.locals.correlationId;
    const send = (status: number, message: string) => res.status(status).json({ error: message, correlationId });

    if (error instanceof ApiError) {
      if (error.graphqlCode) {
        res.status(error.status).json({ errors: [{ message: error.message, extensions: { code: error.graphqlCode, correlationId } }] });
      } else {
        send(error.status, error.message);
      }
      return;
    }
    if (isAppError(error)) {
      const status = APP_ERROR_STATUS[error.code];
      if (status !== undefined) return void send(status, error.message);
    }
    if (error instanceof NotFoundException) {
      // Production: unknown browser paths are client-side routes of the SPA.
      const staticDir = this.options.staticDir;
      if (staticDir && req.method === 'GET' && req.accepts('html') && !API_PREFIXES.some((p) => req.path.startsWith(p))) {
        return res.sendFile(join(staticDir, 'index.html'), { headers: { 'cache-control': 'no-cache' } });
      }
      return void send(404, 'Not found.');
    }
    if (error instanceof HttpException && error.getStatus() < 500) {
      return void send(error.getStatus(), error.message);
    }
    // Body-parser errors (413, 400 invalid JSON, 415 charset) carry a status.
    const httpError: HttpLikeError = typeof error === 'object' && error !== null ? error : {};
    const status = clientStatus(httpError);
    if (status !== null) return void send(status, clientMessage(httpError, status));

    this.services.logger.error({ err: error, correlationId, path: req.path }, 'unhandled request error');
    send(500, 'Internal server error.');
  }
}
