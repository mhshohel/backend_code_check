import { badInput, forbidden, isStaff, notFound, unauthenticated, uuidSchema } from '@ofl/domain';
import type { SessionUser } from './sessions';

export function requireViewer(viewer: SessionUser | null): SessionUser {
  if (!viewer) throw unauthenticated();
  return viewer;
}

export function requireCustomer(viewer: SessionUser | null): SessionUser {
  const user = requireViewer(viewer);
  if (user.role !== 'CUSTOMER') throw forbidden();
  return user;
}

export function requireStaff(viewer: SessionUser | null): SessionUser {
  const user = requireViewer(viewer);
  if (!isStaff(user.role)) throw forbidden();
  return user;
}

export function requireAdmin(viewer: SessionUser | null): SessionUser {
  const user = requireViewer(viewer);
  if (user.role !== 'ADMIN') throw forbidden();
  return user;
}

/** Customers see only their own orders; anything else looks like a missing order. */
export function canViewOrder(viewer: SessionUser, order: { customerId: string }): boolean {
  return isStaff(viewer.role) || order.customerId === viewer.id;
}

/** An id that is not a UUID cannot exist; report it like any other missing object. */
export function parseEntityId(value: string, what: string): string {
  if (!uuidSchema.safeParse(value).success) throw notFound(what);
  return value;
}

/** Filter arguments that must be ids: a malformed value is bad input, not a missing object. */
export function parseIdArgument(value: string, path: string): string;
export function parseIdArgument(value: string | null | undefined, path: string): string | null;
export function parseIdArgument(value: string | null | undefined, path: string): string | null {
  if (value === null || value === undefined) return null;
  if (!uuidSchema.safeParse(value).success) throw badInput('The id is not valid.', [{ path, message: 'Must be a valid ID.' }]);
  return value;
}
