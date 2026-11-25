import { jest } from '@jest/globals';
import type { ViewerQuery } from '@ofl/graphql-types';
import { render, type RenderResult } from '@testing-library/react';
import type { DocumentNode } from 'graphql';
import { createMemoryRouter } from 'react-router';
import type { Client, GraphQLRequest, OperationResult } from 'urql';
import { concat, fromValue, never, type Source } from 'wonka';
import { App } from '../src/app/App';
import { createAppStore, type AppStore } from '../src/app/store';
import { appRoutes } from '../src/app/routes';
import type { KeyValueStorage } from '../src/app/persistence';
import type { SpaConfig } from '../src/config';

export type Viewer = NonNullable<ViewerQuery['viewer']>;
type Variables = Record<string, unknown>;
type MockResult = Partial<Pick<OperationResult, 'data' | 'error'>>;
/** Returns a plain result (emitted once) or a wonka source (for streams such as subscriptions). */
export type Handler = (variables: Variables) => MockResult | Source<MockResult>;

export const testConfig: SpaConfig = {
  variantName: 'Test',
  graphqlPath: '/graphql',
  wsUrl: 'ws://localhost/graphql',
  authBasePath: '/auth',
};

export const viewers = {
  customer: { id: 'u-customer', email: 'customer@example.com', displayName: 'Casey Customer', role: 'CUSTOMER' },
  operator: { id: 'u-operator', email: 'operator@example.com', displayName: 'Olive Operator', role: 'OPERATOR' },
  admin: { id: 'u-admin', email: 'admin@example.com', displayName: 'Ada Admin', role: 'ADMIN' },
} satisfies Record<string, Viewer>;

export function operationName(query: DocumentNode): string {
  for (const definition of query.definitions) {
    if (definition.kind === 'OperationDefinition' && definition.name) return definition.name.value;
  }
  return '(anonymous)';
}

function isSource(value: MockResult | Source<MockResult>): value is Source<MockResult> {
  return typeof value === 'function';
}

export type MockClient = {
  client: Client;
  executeQuery: jest.Mock<(request: GraphQLRequest) => Source<MockResult>>;
  executeMutation: jest.Mock<(request: GraphQLRequest) => Source<MockResult>>;
  executeSubscription: jest.Mock<(request: GraphQLRequest) => Source<MockResult>>;
  /** Variables of every call of `name`, in order. */
  calls(name: string): Variables[];
};

/**
 * A urql Client double at the client boundary: each operation name maps to a
 * handler. Unknown operations never resolve (stay "fetching").
 */
export function createMockClient(handlers: Record<string, Handler>): MockClient {
  const requests: Array<{ name: string; variables: Variables }> = [];
  const respond = (request: GraphQLRequest): Source<MockResult> => {
    const name = operationName(request.query as DocumentNode);
    const variables = (request.variables ?? {}) as Variables;
    requests.push({ name, variables });
    const handler = handlers[name];
    if (!handler) return never;
    const result = handler(variables);
    // Real urql query streams stay open after the first result; so do these.
    return isSource(result) ? result : concat([fromValue(result), never]);
  };
  const executeQuery = jest.fn(respond);
  const executeMutation = jest.fn(respond);
  const executeSubscription = jest.fn(respond);
  const client = { executeQuery, executeMutation, executeSubscription, suspense: false } as unknown as Client;
  return {
    client,
    executeQuery,
    executeMutation,
    executeSubscription,
    calls: (name) => requests.filter((r) => r.name === name).map((r) => r.variables),
  };
}

export function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

type RenderAppOptions = {
  path: string;
  handlers?: Record<string, Handler>;
  viewer?: Viewer | null;
  store?: AppStore;
};

export type RenderedApp = RenderResult & {
  mock: MockClient;
  store: AppStore;
  router: ReturnType<typeof createMemoryRouter>;
};

export function renderApp({ path, handlers = {}, viewer = null, store }: RenderAppOptions): RenderedApp {
  const mock = createMockClient({ Viewer: () => ({ data: { viewer } }), ...handlers });
  const appStore = store ?? createAppStore({ storage: memoryStorage() });
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  const handle = { client: mock.client, dispose: () => undefined };
  const result = render(<App config={testConfig} store={appStore} createClient={() => handle} router={router} />);
  return { ...result, mock, store: appStore, router };
}
