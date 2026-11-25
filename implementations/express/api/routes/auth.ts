import { login, logout, SESSION_COOKIE_NAME, sessionCookieOptions, type Services } from '@ofl/server-core';
import express, { Router, type CookieOptions, type RequestHandler } from 'express';
import { sendError } from '../http-errors';
import { requireCsrfHeader } from '../middleware/csrf';
import { requestMeta } from '../request-meta';

function cookieOptions(services: Services): CookieOptions {
  const options = sessionCookieOptions(services.config);
  return { httpOnly: options.httpOnly, sameSite: options.sameSite, secure: options.secure, path: options.path };
}

/** POST /auth/login and /auth/logout. Express owns the cookie; server-core owns sessions. */
export function authRoutes(services: Services, options: { loginLimiter: RequestHandler; bodyLimit: string }): Router {
  const router = Router();
  router.use(requireCsrfHeader('json'));
  router.use(express.json({ limit: options.bodyLimit }));

  router.post('/login', options.loginLimiter, async (req, res) => {
    // Invalid input throws AppError BAD_USER_INPUT; the error handler answers 400.
    const result = await login(services, req.body, requestMeta(req, res));
    if (result.kind === 'invalid') return sendError(res, 401, 'The email or password is incorrect.');
    const maxAgeMs = sessionCookieOptions(services.config).maxAgeSeconds * 1000;
    res.cookie(SESSION_COOKIE_NAME, result.token, { ...cookieOptions(services), maxAge: maxAgeMs });
    res.status(200).json({ user: result.user });
  });

  router.post('/logout', async (req, res) => {
    const cookies: Record<string, unknown> = req.cookies ?? {};
    const token = cookies[SESSION_COOKIE_NAME];
    await logout(services, typeof token === 'string' ? token : undefined);
    res.clearCookie(SESSION_COOKIE_NAME, cookieOptions(services));
    res.status(204).end();
  });

  return router;
}
