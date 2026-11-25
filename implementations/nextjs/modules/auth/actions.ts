'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE_NAME, login, logout, sessionCookieOptions } from '@ofl/server-core';
import { getServices } from '../server/services';
import { RATE_LIMITS, checkRateLimit } from '../server/http/rate-limit';
import { requestMetaFrom } from '../server/http/request-meta';
import { safeReturnPath } from './return-path';

export type LoginFormState = { error: string | null; email: string };

/**
 * UI login. Server Actions only accept POST and Next compares the Origin
 * header with the host before running them, which is the CSRF defence here
 * (the JSON route handler uses the x-ofl-csrf header instead).
 */
export async function loginAction(_previous: LoginFormState, formData: FormData): Promise<LoginFormState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const meta = requestMetaFrom(await headers());

  const limit = checkRateLimit(RATE_LIMITS.login, meta.ip ?? 'unknown');
  if (!limit.allowed) return { error: `Too many sign-in attempts. Try again in ${limit.retryAfterSeconds} seconds.`, email };

  const services = await getServices();
  const result = await login(services, { email, password }, meta);
  if (result.kind !== 'ok') return { error: 'Email or password is incorrect.', email };

  const options = sessionCookieOptions(services.config);
  (await cookies()).set(SESSION_COOKIE_NAME, result.token, {
    httpOnly: options.httpOnly,
    sameSite: options.sameSite,
    secure: options.secure,
    path: options.path,
    maxAge: options.maxAgeSeconds,
  });
  // redirect() throws, so it must stay outside any try/catch.
  redirect(safeReturnPath(formData.get('next')));
}

export async function logoutAction(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  await logout(await getServices(), token);
  store.delete(SESSION_COOKIE_NAME);
  redirect('/');
}
