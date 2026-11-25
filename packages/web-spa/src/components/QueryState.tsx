import type { CombinedError } from '@urql/core';
import type { ReactNode } from 'react';
import { describeError } from '../graphql/errors';
import { ErrorAlert, Spinner } from './Status';

type QueryStateProps<T> = {
  fetching: boolean;
  error?: CombinedError | undefined;
  data?: T | undefined;
  loadingLabel?: string;
  children: (data: T) => ReactNode;
};

/** Renders loading, error, or data for one urql query result. */
export function QueryState<T>({ fetching, error, data, loadingLabel = 'Loading…', children }: QueryStateProps<T>) {
  if (data !== undefined) return <>{children(data)}</>;
  if (error) return <ErrorAlert>{describeError(error).message}</ErrorAlert>;
  if (fetching) return <Spinner label={loadingLabel} />;
  return null;
}

export function ErrorFor({ error }: { error: CombinedError | undefined }) {
  return error ? <ErrorAlert>{describeError(error).message}</ErrorAlert> : null;
}
