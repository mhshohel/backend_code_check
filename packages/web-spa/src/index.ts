// Public entry of @ofl/web-spa. Hosts call mountApp; tests use App and the factories.
export { mountApp, type MountedApp } from './mount';
export { App, type AppProps } from './app/App';
export { AppProviders, type AppProvidersProps } from './app/AppProviders';
export { appRoutes } from './app/routes';
export { createAppStore, type AppStore, type RootState } from './app/store';
export { createGraphQLClient, CSRF_HEADER, type GraphQLClientHandle } from './graphql/client';
export type { SpaConfig } from './config';
