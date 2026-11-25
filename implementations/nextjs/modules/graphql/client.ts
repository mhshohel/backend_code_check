import { Client, cacheExchange, fetchExchange, subscriptionExchange, type Exchange } from '@urql/core';
import { createClient as createWsClient, type Client as WsClient } from 'graphql-ws';
import type { RealtimeStatusStore } from '../realtime/connection-status';

export const GRAPHQL_PATH = '/api/graphql';

export type UrqlClientOptions = {
  /** ws:// URL of the realtime service, or null to disable subscriptions (tests). */
  realtimeUrl: string | null;
  realtimeStatus: RealtimeStatusStore;
};

// Reconnect with capped exponential backoff and jitter. graphql-ws resubscribes
// every active subscription after reconnecting, and the server emits the
// current order first, so state missed while offline is replaced, not replayed.
async function backoff(retries: number): Promise<void> {
  const base = Math.min(30_000, 500 * 2 ** retries);
  const delay = base / 2 + Math.random() * (base / 2);
  await new Promise((resolve) => setTimeout(resolve, delay));
}

export function createRealtimeClient(url: string, status: RealtimeStatusStore): WsClient {
  return createWsClient({
    url,
    lazy: true,
    // Close the socket shortly after the last subscription ends (page left).
    lazyCloseTimeout: 3_000,
    retryAttempts: Number.POSITIVE_INFINITY,
    shouldRetry: () => true,
    retryWait: backoff,
    on: {
      connecting: (isRetry) => status.set(isRetry ? 'reconnecting' : 'connecting'),
      connected: () => status.set('connected'),
      closed: () => status.set('idle'),
    },
  });
}

function realtimeExchange(wsClient: WsClient): Exchange {
  return subscriptionExchange({
    forwardSubscription(request) {
      const input = { ...request, query: request.query ?? '' };
      return {
        subscribe(sink) {
          const unsubscribe = wsClient.subscribe(input, sink);
          return { unsubscribe };
        },
      };
    },
  });
}

/**
 * Browser GraphQL client. Queries and mutations go to /api/graphql on the
 * same origin with the session cookie and the CSRF header; subscriptions go
 * to the realtime service. Every request uses POST so the CSRF rule is uniform.
 */
export function createUrqlClient(options: UrqlClientOptions): Client {
  const exchanges: Exchange[] = [cacheExchange];
  if (options.realtimeUrl) exchanges.push(realtimeExchange(createRealtimeClient(options.realtimeUrl, options.realtimeStatus)));
  exchanges.push(fetchExchange);

  return new Client({
    url: GRAPHQL_PATH,
    exchanges,
    preferGetMethod: false,
    fetchOptions: () => ({ credentials: 'same-origin', headers: { 'x-ofl-csrf': '1' } }),
  });
}
