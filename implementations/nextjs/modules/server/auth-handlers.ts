import 'server-only';
import {
  SESSION_COOKIE_NAME,
  login,
  logout,
  sessionCookieOptions,
  type RequestMeta,
} from '@ofl/server-core';
import { getServices } from './services';
import {
  assertCsrfHeader,
  assertRateLimit,
  assertRateLimitFor,
  assertSameOrigin,
  errorResponse,
  jsonResponse,
  readBodyWithLimit,
  PRIVATE_NO_STORE,
} from './http/guards';
import { RATE_LIMITS, loginAccountKey } from './http/rate-limit';
import { cookieValue } from './http/request-meta';
import { expiredCookie, serializeCookie } from './http/cookies';
import { appErrorCode } from './app-error';

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** POST /api/auth/login — contract in requirements §10. */
export async function handleLogin(request: Request, meta: RequestMeta): Promise<Response> {
  assertSameOrigin(request);
  assertCsrfHeader(request);
  assertRateLimit(request, RATE_LIMITS.login);
  const body = parseJson(await readBodyWithLimit(request));
  if (typeof body !== 'object' || body === null) return errorResponse(400, 'Send a JSON object with email and password.');
  const attemptedEmail = (body as { email?: unknown }).email;
  if (typeof attemptedEmail === 'string') assertRateLimitFor(RATE_LIMITS.loginAccount, loginAccountKey(attemptedEmail));

  const services = await getServices();
  let result: Awaited<ReturnType<typeof login>>;
  try {
    result = await login(services, body, meta);
  } catch (error) {
    if (appErrorCode(error) === 'BAD_USER_INPUT') return errorResponse(400, 'Email and password are required.');
    throw error;
  }
  if (result.kind !== 'ok') return errorResponse(401, 'Email or password is incorrect.');

  const { id, email, displayName, role } = result.user;
  const cookie = serializeCookie(SESSION_COOKIE_NAME, result.token, sessionCookieOptions(services.config));
  return jsonResponse({ user: { id, email, displayName, role } }, 200, { 'Set-Cookie': cookie });
}

/** POST /api/auth/logout — revokes the session server-side and expires the cookie. */
export async function handleLogout(request: Request): Promise<Response> {
  assertSameOrigin(request);
  assertCsrfHeader(request);
  const services = await getServices();
  await logout(services, cookieValue(request.headers.get('cookie'), SESSION_COOKIE_NAME));
  return new Response(null, {
    status: 204,
    headers: {
      'Set-Cookie': expiredCookie(SESSION_COOKIE_NAME, sessionCookieOptions(services.config)),
      'Cache-Control': PRIVATE_NO_STORE,
    },
  });
}
