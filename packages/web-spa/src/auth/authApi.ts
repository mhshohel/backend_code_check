import type { ViewerQuery } from '@ofl/graphql-types';
import { CSRF_HEADER } from '../graphql/client';

export type Viewer = NonNullable<ViewerQuery['viewer']>;

export type LoginOutcome = { kind: 'ok' } | { kind: 'error'; message: string };

const LOGIN_MESSAGES: Record<number, string> = {
  400: 'Enter a valid email address and password.',
  401: 'The email or password is incorrect.',
  403: 'The request was blocked. Reload the page and try again.',
  429: 'Too many sign-in attempts. Wait a minute and try again.',
};

/** POST {authBasePath}/login. The server sets the HttpOnly session cookie. */
export async function postLogin(authBasePath: string, credentials: { email: string; password: string }): Promise<LoginOutcome> {
  try {
    const response = await fetch(`${authBasePath}/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...CSRF_HEADER },
      body: JSON.stringify(credentials),
    });
    if (response.ok) return { kind: 'ok' };
    return { kind: 'error', message: LOGIN_MESSAGES[response.status] ?? 'Sign-in failed. Please try again.' };
  } catch {
    return { kind: 'error', message: 'We could not reach the server. Check your connection and try again.' };
  }
}

/** POST {authBasePath}/logout. Network failures are reported to the caller. */
export async function postLogout(authBasePath: string): Promise<boolean> {
  try {
    const response = await fetch(`${authBasePath}/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: { ...CSRF_HEADER },
    });
    return response.ok;
  } catch {
    return false;
  }
}
