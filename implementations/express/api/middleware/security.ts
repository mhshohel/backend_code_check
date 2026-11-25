import cors from 'cors';
import type { RequestHandler } from 'express';
import helmet from 'helmet';

export const ALLOWED_REQUEST_HEADERS = ['content-type', 'x-ofl-csrf', 'x-correlation-id', 'x-ofl-debug-query-count'];

export function securityHeaders(production: boolean): RequestHandler {
  // In development the SPA comes from Vite and GraphiQL loads from a CDN, so
  // the CSP is only enforced for the production build that Express serves.
  // upgrade-insecure-requests is dropped: the lab serves plain http://localhost.
  return helmet({
    contentSecurityPolicy: production ? { directives: { 'upgrade-insecure-requests': null } } : false,
  });
}

/** Only the variant's own web origins may make credentialed cross-origin calls. */
export function corsAllowlist(allowedOrigins: readonly string[]): RequestHandler {
  return cors({
    origin: (origin, callback) => callback(null, origin === undefined || allowedOrigins.includes(origin)),
    credentials: true,
    allowedHeaders: ALLOWED_REQUEST_HEADERS,
    exposedHeaders: ['x-correlation-id'],
    methods: ['GET', 'POST', 'OPTIONS'],
    maxAge: 600,
  });
}
