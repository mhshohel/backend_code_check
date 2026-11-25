import { resolveSession, SESSION_COOKIE_NAME, type Services } from '@ofl/server-core';
import type { RequestHandler } from 'express';

/** Reads the session cookie (cookie-parser runs first) and resolves the viewer once per request. */
export function sessionMiddleware(services: Services): RequestHandler {
  return async (req, res, next) => {
    const cookies: Record<string, unknown> = req.cookies ?? {};
    const token = cookies[SESSION_COOKIE_NAME];
    res.locals.viewer = await resolveSession(services, typeof token === 'string' ? token : undefined);
    next();
  };
}
