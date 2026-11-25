import type { Role } from '@ofl/graphql-types';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { ErrorAlert, Spinner } from '../components';
import { hasRole, useSession } from './session';

type RequireRoleProps = { roles?: readonly Role[]; children: ReactNode };

/** Route guard for the UI. Authorization itself is enforced by the server. */
export function RequireRole({ roles, children }: RequireRoleProps) {
  const { viewer, loading } = useSession();
  const location = useLocation();
  if (loading) return <Spinner label="Checking your session…" />;
  if (!viewer) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  if (roles && !hasRole(viewer, roles)) {
    return <ErrorAlert title="Not available">Your account does not have access to this page.</ErrorAlert>;
  }
  return <>{children}</>;
}
