import type { RequestHandler } from 'express';
import { sendError, sendGraphQLError } from '../http-errors';

export const CSRF_HEADER = 'x-ofl-csrf';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * A cross-site page cannot add a custom header without a CORS preflight,
 * and CORS only allows our own origin. Mounted only on browser routes
 * (/graphql, /auth); the webhook is authenticated by its signature instead.
 */
export function requireCsrfHeader(kind: 'json' | 'graphql'): RequestHandler {
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method) || req.get(CSRF_HEADER) === '1') return next();
    const message = `Missing ${CSRF_HEADER} header.`;
    if (kind === 'graphql') sendGraphQLError(res, 403, 'FORBIDDEN', message);
    else sendError(res, 403, message);
  };
}
