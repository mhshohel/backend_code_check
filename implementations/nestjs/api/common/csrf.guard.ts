import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ApiError } from './api-error';
import { GRAPHQL_ERRORS_KEY } from './decorators';

export const CSRF_HEADER = 'x-ofl-csrf';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * A cross-site page cannot add a custom header without a CORS preflight, and
 * CORS only allows our own origin. Applied with @UseGuards on the browser
 * controllers (auth, GraphQL); the webhook is authenticated by its signature.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method) || req.get(CSRF_HEADER) === '1') return true;
    const graphql = this.reflector.getAllAndOverride<boolean>(GRAPHQL_ERRORS_KEY, [context.getHandler(), context.getClass()]);
    throw new ApiError(403, `Missing ${CSRF_HEADER} header.`, graphql ? 'FORBIDDEN' : undefined);
  }
}
