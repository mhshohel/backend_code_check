import { createContext, useContext } from 'react';

/** Per-variant settings passed by the host (Express or Fastify `web/` entry). */
export type SpaConfig = {
  /** Shown in the header, for example "Express". */
  variantName: string;
  /** GraphQL HTTP endpoint path or URL, for example "/graphql". */
  graphqlPath: string;
  /** graphql-ws endpoint, for example "ws://localhost:9002/graphql". */
  wsUrl: string;
  /** Base path of the auth routes, for example "/auth" (POST /auth/login, /auth/logout). */
  authBasePath: string;
};

export const SpaConfigContext = createContext<SpaConfig | null>(null);

export function useSpaConfig(): SpaConfig {
  const config = useContext(SpaConfigContext);
  if (!config) throw new Error('useSpaConfig must be used inside <AppProviders>.');
  return config;
}
