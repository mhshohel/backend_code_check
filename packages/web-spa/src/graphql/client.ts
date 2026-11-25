import { cacheExchange, Client, fetchExchange, subscriptionExchange } from '@urql/core';
import { createClient as createWsClient, type Client as WsClient } from 'graphql-ws';
import type { SpaConfig } from '../config';
import type { LiveConnection } from '../features/ui/uiSlice';

export const CSRF_HEADER = { 'x-ofl-csrf': '1' } as const;

export type GraphQLClientHandle = { client: Client; dispose(): void };

/**
 * One urql client for queries, mutations and subscriptions.
 *
 * Cache choice: urql's document cache (`cacheExchange` from @urql/core), not
 * graphcache. Results are cached per operation + variables, and a mutation
 * invalidates every cached query that contained a returned __typename (for
 * example any Order). That is enough here because every mutation returns the
 * changed Order/Job/Sku and live order state arrives through the
 * subscription. Graphcache would add normalized updates at the cost of a
 * dependency, schema awareness and per-mutation updaters.
 *
 * Every request is a POST with `x-ofl-csrf: 1` and the session cookie
 * (`preferGetMethod: false`), because the server requires the header.
 */
export function createGraphQLClient(
  config: SpaConfig,
  onConnectionChange: (state: LiveConnection) => void = () => undefined,
): GraphQLClientHandle {
  const wsClient = createWebSocketClient(config.wsUrl, onConnectionChange);
  const client = new Client({
    url: config.graphqlPath,
    preferGetMethod: false,
    fetchOptions: { credentials: 'include', headers: { ...CSRF_HEADER } },
    exchanges: [
      cacheExchange,
      fetchExchange,
      subscriptionExchange({
        forwardSubscription(request) {
          const input = { ...request, query: request.query ?? '' };
          return {
            subscribe(sink) {
              const unsubscribe = wsClient.subscribe(input, sink);
              return { unsubscribe };
            },
          };
        },
      }),
    ],
  });
  return { client, dispose: () => void wsClient.dispose() };
}

function createWebSocketClient(url: string, onConnectionChange: (state: LiveConnection) => void): WsClient {
  let connectedBefore = false;
  return createWsClient({
    url,
    lazy: true,
    // On reconnect graphql-ws re-subscribes, and the server sends the current
    // order state first, so missed events are replaced by the latest state.
    retryAttempts: Number.POSITIVE_INFINITY,
    shouldRetry: () => true,
    on: {
      connecting: () => onConnectionChange(connectedBefore ? 'reconnecting' : 'connecting'),
      connected: () => {
        connectedBefore = true;
        onConnectionChange('connected');
      },
      closed: () => onConnectionChange(connectedBefore ? 'reconnecting' : 'idle'),
    },
  });
}
