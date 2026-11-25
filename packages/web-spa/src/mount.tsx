import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { AppProviders } from './app/AppProviders';
import { appRoutes } from './app/routes';
import { browserStorage } from './app/persistence';
import { createAppStore } from './app/store';
import type { SpaConfig } from './config';
import { liveConnectionChanged } from './features/ui/uiSlice';
import { createGraphQLClient, type GraphQLClientHandle } from './graphql/client';
import './styles/app.css';

export type MountedApp = { unmount(): void };

/**
 * Mounts the SPA into `element`. Used by the Express and Fastify `web/` entries:
 *
 *   mountApp(document.getElementById('root')!, {
 *     variantName: 'Express', graphqlPath: '/graphql',
 *     wsUrl: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/graphql`,
 *     authBasePath: '/auth',
 *   });
 */
export function mountApp(element: HTMLElement, config: SpaConfig): MountedApp {
  const store = createAppStore({ storage: browserStorage() });
  const router = createBrowserRouter(appRoutes);
  let latest: GraphQLClientHandle | null = null;
  const createClient = () => {
    latest = createGraphQLClient(config, (state) => store.dispatch(liveConnectionChanged(state)));
    return latest;
  };
  document.title = `Order Fulfillment Lab (${config.variantName})`;
  const root = createRoot(element);
  root.render(
    <StrictMode>
      <AppProviders config={config} store={store} createClient={createClient}>
        <RouterProvider router={router} />
      </AppProviders>
    </StrictMode>,
  );
  return {
    unmount() {
      root.unmount();
      router.dispose();
      latest?.dispose();
    },
  };
}
