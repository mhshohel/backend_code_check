import { ViewerDocument, type Role } from '@ofl/graphql-types';
import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useQuery } from 'urql';
import { useSpaConfig } from '../config';
import { postLogin, postLogout, type LoginOutcome, type Viewer } from './authApi';

export type Session = {
  viewer: Viewer | null;
  /** True until the first Query.viewer answer arrives. */
  loading: boolean;
  signIn(email: string, password: string): Promise<LoginOutcome>;
  signOut(): Promise<boolean>;
};

const SessionContext = createContext<Session | null>(null);

/** Resets the GraphQL client (and with it the whole urql cache). */
export const ClientResetContext = createContext<() => void>(() => undefined);

export function SessionProvider({ children }: { children: ReactNode }) {
  const { authBasePath } = useSpaConfig();
  const resetClient = useContext(ClientResetContext);
  const [{ data, fetching, error }] = useQuery({ query: ViewerDocument });

  // A new client after sign-in/out drops cached data of the previous user.
  const signIn = useCallback(
    async (email: string, password: string) => {
      const outcome = await postLogin(authBasePath, { email, password });
      if (outcome.kind === 'ok') resetClient();
      return outcome;
    },
    [authBasePath, resetClient],
  );
  const signOut = useCallback(async () => {
    const ok = await postLogout(authBasePath);
    if (ok) resetClient();
    return ok;
  }, [authBasePath, resetClient]);

  const value = useMemo<Session>(
    () => ({ viewer: data?.viewer ?? null, loading: fetching && !data && !error, signIn, signOut }),
    [data, fetching, error, signIn, signOut],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside <SessionProvider>.');
  return session;
}

/**
 * UI convenience only: hides controls the viewer cannot use. The server
 * enforces every permission again in @ofl/server-core.
 */
export function hasRole(viewer: Viewer | null, roles: readonly Role[]): boolean {
  return viewer !== null && roles.includes(viewer.role);
}

export const STAFF_ROLES: readonly Role[] = ['OPERATOR', 'ADMIN'];
export const ADMIN_ROLES: readonly Role[] = ['ADMIN'];
export const CUSTOMER_ROLES: readonly Role[] = ['CUSTOMER'];
