import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Provider as ReduxProvider } from 'react-redux';
import { Provider as UrqlProvider } from 'urql';
import { SpaConfigContext, type SpaConfig } from '../config';
import { ClientResetContext, SessionProvider } from '../auth/session';
import type { GraphQLClientHandle } from '../graphql/client';
import type { AppStore } from './store';

export type AppProvidersProps = {
  config: SpaConfig;
  store: AppStore;
  /** Called once at start and again after sign-in/out to drop the previous user's cache. */
  createClient: () => GraphQLClientHandle;
  children: ReactNode;
};

export function AppProviders({ config, store, createClient, children }: AppProvidersProps) {
  const [handle, setHandle] = useState(createClient);
  const current = useRef(handle);
  const resetClient = useCallback(() => {
    current.current.dispose();
    current.current = createClient();
    setHandle(current.current);
  }, [createClient]);

  return (
    <SpaConfigContext.Provider value={config}>
      <ReduxProvider store={store}>
        <ClientResetContext.Provider value={resetClient}>
          <UrqlProvider value={handle.client}>
            <SessionProvider>{children}</SessionProvider>
          </UrqlProvider>
        </ClientResetContext.Provider>
      </ReduxProvider>
    </SpaConfigContext.Provider>
  );
}
