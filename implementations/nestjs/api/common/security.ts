import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface.js';
import type { RequestHandler } from 'express';
import helmet from 'helmet';

export const ALLOWED_REQUEST_HEADERS = ['content-type', 'x-ofl-csrf', 'x-correlation-id', 'x-ofl-debug-query-count'];

export function securityHeaders(production: boolean): RequestHandler {
  // In development the SPA comes from Vite and GraphiQL loads from a CDN, so
  // the CSP is only enforced for the production build that Nest serves.
  // upgrade-insecure-requests is dropped: the lab serves plain http://localhost.
  return helmet({
    contentSecurityPolicy: production ? { directives: { 'upgrade-insecure-requests': null } } : false,
  });
}

/** For app.enableCors(): only the variant's own web origins may make credentialed calls. */
export function corsOptions(allowedOrigins: readonly string[]): CorsOptions {
  return {
    origin: (origin, callback) => callback(null, origin === undefined || allowedOrigins.includes(origin)),
    credentials: true,
    allowedHeaders: ALLOWED_REQUEST_HEADERS,
    exposedHeaders: ['x-correlation-id'],
    methods: ['GET', 'POST', 'OPTIONS'],
    maxAge: 600,
  };
}
