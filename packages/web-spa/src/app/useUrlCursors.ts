import { useCallback } from 'react';
import { useSearchParams } from 'react-router';

/**
 * "Load more" pages kept in the URL: each loaded page adds its `after`
 * cursor as a repeated query parameter, so reload and back/forward restore
 * every loaded page. The first page has cursor null.
 */
export function useUrlCursors(param = 'after') {
  const [searchParams, setSearchParams] = useSearchParams();
  const cursors: Array<string | null> = [null, ...searchParams.getAll(param)];
  const loadMore = useCallback(
    (cursor: string) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.append(param, cursor);
          return next;
        },
        { replace: true, preventScrollReset: true },
      );
    },
    [param, setSearchParams],
  );
  return { cursors, loadMore };
}

/** Returns a copy of `params` with changes applied and pagination cursors removed. */
export function updateParams(
  params: URLSearchParams,
  changes: Record<string, string | readonly string[] | null>,
  cursorParams: readonly string[] = ['after'],
): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const name of cursorParams) next.delete(name);
  for (const [key, value] of Object.entries(changes)) {
    next.delete(key);
    if (value === null || value === '') continue;
    if (typeof value === 'string') next.set(key, value);
    else for (const item of value) next.append(key, item);
  }
  return next;
}
