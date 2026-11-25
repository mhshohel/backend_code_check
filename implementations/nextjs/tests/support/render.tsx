import type { ReactElement, ReactNode } from 'react';
import { render } from '@testing-library/react';
import { Provider as ReduxProvider } from 'react-redux';
import { Provider as UrqlProvider, type Client } from 'urql';
import { fromValue, never } from 'wonka';
import type { OperationResult } from '@urql/core';
import { makeStore, type AppStore, type RootState } from '@/modules/store/store';

export type FakeResponder = (operationName: string, variables: Record<string, unknown>) => Partial<OperationResult> | null;

export type FakeClient = {
  client: Client;
  calls: Array<{ operationName: string; variables: Record<string, unknown> }>;
};

function operationName(query: unknown): string {
  const definitions = (query as { definitions?: Array<{ kind: string; name?: { value: string } }> }).definitions ?? [];
  return definitions.find((definition) => definition.kind === 'OperationDefinition')?.name?.value ?? 'unknown';
}

/** A urql client double: every operation is answered synchronously by `respond`. */
export function createFakeClient(respond: FakeResponder): FakeClient {
  const calls: FakeClient['calls'] = [];
  const execute = (request: { query: unknown; variables?: Record<string, unknown> }) => {
    const name = operationName(request.query);
    const variables = request.variables ?? {};
    calls.push({ operationName: name, variables });
    const result = respond(name, variables);
    return result ? fromValue({ stale: false, hasNext: false, ...result }) : never;
  };
  const client = {
    executeQuery: execute,
    executeMutation: execute,
    executeSubscription: execute,
    // urql hooks also call these; they are not used by the doubles.
    suspense: false,
  } as unknown as Client;
  return { client, calls };
}

export function renderWithProviders(
  ui: ReactElement,
  options: { client?: Client; preloadedState?: Partial<RootState> } = {},
): ReturnType<typeof render> & { store: AppStore } {
  const store = makeStore(options.preloadedState);
  const client = options.client ?? createFakeClient(() => null).client;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ReduxProvider store={store}>
      <UrqlProvider value={client}>{children}</UrqlProvider>
    </ReduxProvider>
  );
  const result = render(ui, { wrapper });
  return Object.assign(result, { store });
}
