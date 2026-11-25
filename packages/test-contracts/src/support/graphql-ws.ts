import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { print } from 'graphql';
import { createClient, type Client } from 'graphql-ws';
import WebSocket from 'ws';
import type { GraphQLErrorShape } from './graphql-http';
import { waitFor, type WaitForOptions } from './wait-for';

/** A `ws` constructor that sends the session cookie on the upgrade request. */
function webSocketWithCookie(cookie: string | undefined): typeof WebSocket {
  const headers: Record<string, string> = cookie ? { cookie } : {};
  return class CookieWebSocket extends WebSocket {
    constructor(address: string | URL, protocols?: string | string[]) {
      super(address, protocols, { headers });
    }
  } as unknown as typeof WebSocket;
}

export function createWsClient(wsUrl: string, cookie: string | undefined): Client {
  return createClient({
    url: wsUrl,
    webSocketImpl: webSocketWithCookie(cookie),
    lazy: true,
    retryAttempts: 0,
  });
}

export type SubscriptionRecorder<TData> = {
  readonly events: TData[];
  readonly errors: GraphQLErrorShape[];
  nextEvent(predicate: (event: TData) => boolean, options?: WaitForOptions): Promise<TData>;
  firstError(options?: WaitForOptions): Promise<GraphQLErrorShape>;
  unsubscribe(): void;
};

function toErrorShapes(error: unknown): GraphQLErrorShape[] {
  if (Array.isArray(error)) return error as GraphQLErrorShape[];
  if (error instanceof Error) return [{ message: error.message }];
  return [{ message: JSON.stringify(error) }];
}

/** Subscribes and records every payload and error for later assertions. */
export function recordSubscription<TData, TVariables extends Record<string, unknown>>(
  client: Client,
  document: TypedDocumentNode<TData, TVariables>,
  variables: TVariables,
): SubscriptionRecorder<TData> {
  const events: TData[] = [];
  const errors: GraphQLErrorShape[] = [];
  const unsubscribe = client.subscribe<TData>(
    { query: print(document), variables },
    {
      next: (result) => {
        if (result.errors?.length) errors.push(...toErrorShapes(result.errors));
        if (result.data) events.push(result.data);
      },
      error: (error) => errors.push(...toErrorShapes(error)),
      complete: () => undefined,
    },
  );
  return {
    events,
    errors,
    unsubscribe,
    nextEvent: (predicate, options) =>
      waitFor(() => events.find(predicate), { description: 'subscription event', ...options }),
    firstError: (options) => waitFor(() => errors[0], { description: 'subscription error', ...options }),
  };
}
