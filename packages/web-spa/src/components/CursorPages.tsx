import type { AnyVariables, DocumentInput } from '@urql/core';
import type { ReactNode } from 'react';
import { useQuery, type UseQueryArgs } from 'urql';
import { LoadMore } from './LoadMore';
import { ErrorFor } from './QueryState';
import { Spinner } from './Status';

export type PageInfo = { hasNextPage: boolean; endCursor: string | null };
export type ConnectionLike<Edge> = { edges: readonly Edge[]; pageInfo: PageInfo };

type CursorPagesProps<Data, Variables extends AnyVariables, Edge> = {
  query: DocumentInput<Data, Variables>;
  /** Variables for one page; `after` is null for the first page. */
  variablesFor: (after: string | null) => Variables;
  select: (data: Data) => ConnectionLike<Edge>;
  renderEdges: (edges: readonly Edge[]) => ReactNode;
  /** Cursors of loaded pages; the first entry is null (see useUrlCursors). */
  cursors: ReadonlyArray<string | null>;
  onLoadMore: (cursor: string) => void;
  loadMoreLabel?: string;
  empty?: ReactNode;
};

/**
 * Cursor pagination with the urql document cache: one query per loaded page,
 * each cached separately. The last page renders the "Load more" button.
 */
export function CursorPages<Data, Variables extends AnyVariables, Edge>(props: CursorPagesProps<Data, Variables, Edge>) {
  return (
    <>
      {props.cursors.map((cursor, index) => (
        <CursorPage key={cursor ?? '(first)'} {...props} after={cursor} isLast={index === props.cursors.length - 1} />
      ))}
    </>
  );
}

function CursorPage<Data, Variables extends AnyVariables, Edge>({
  query,
  variablesFor,
  select,
  renderEdges,
  onLoadMore,
  loadMoreLabel,
  empty,
  after,
  isLast,
}: CursorPagesProps<Data, Variables, Edge> & { after: string | null; isLast: boolean }) {
  const args = { query, variables: variablesFor(after) } as UseQueryArgs<Variables, Data>;
  const [{ data, fetching, error }] = useQuery<Data, Variables>(args);
  if (!data) return error ? <ErrorFor error={error} /> : fetching ? <Spinner label="Loading…" /> : null;
  const connection = select(data);
  return (
    <>
      {after === null && connection.edges.length === 0 ? empty : renderEdges(connection.edges)}
      {isLast ? (
        <LoadMore
          hasNextPage={connection.pageInfo.hasNextPage}
          endCursor={connection.pageInfo.endCursor}
          onLoadMore={onLoadMore}
          label={loadMoreLabel}
        />
      ) : null}
    </>
  );
}
