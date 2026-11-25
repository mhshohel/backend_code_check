import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { forbidden, redirect } from 'next/navigation';
import { SESSION_COOKIE_NAME, resolveSession, type RequestMeta, type SessionUser } from '@ofl/server-core';
import { getServices } from './services';
import { requestMetaFrom } from './http/request-meta';

export type Role = SessionUser['role'];

// Reading cookies() opts the calling route into dynamic rendering, so any
// page that calls getViewer() is rendered per request and never prerendered
// or stored in the full route cache. React cache() dedupes the lookup within
// one render pass only; it is not shared between requests.
export const getViewer = cache(async (): Promise<SessionUser | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return resolveSession(await getServices(), token);
});

export const getRequestMeta = cache(async (): Promise<RequestMeta> => requestMetaFrom(await headers()));

/** Redirects anonymous visitors to the login page and brings them back afterwards. */
export async function requireViewer(returnTo: string): Promise<SessionUser> {
  const viewer = await getViewer();
  if (!viewer) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  return viewer;
}

export function hasRole(viewer: SessionUser | null, roles: readonly Role[]): boolean {
  return viewer !== null && roles.includes(viewer.role);
}

export const STAFF_ROLES: readonly Role[] = ['OPERATOR', 'ADMIN'];
export const ADMIN_ROLES: readonly Role[] = ['ADMIN'];

/**
 * Page-level guard. Layouts and pages render in parallel in the App Router, so
 * every protected page calls this itself instead of relying on its layout.
 * The application layer still enforces the same rule on every operation.
 */
export async function requireRole(roles: readonly Role[], returnTo: string): Promise<SessionUser> {
  const viewer = await requireViewer(returnTo);
  if (!roles.includes(viewer.role)) forbidden();
  return viewer;
}
