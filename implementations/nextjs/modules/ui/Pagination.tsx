import Link from 'next/link';

type Props = {
  readonly basePath: string;
  /** Query parameters to keep, without `after`. */
  readonly params: URLSearchParams;
  readonly hasNextPage: boolean;
  readonly endCursor: string | null;
  readonly isFirstPage: boolean;
};

/**
 * Cursor pagination with links (works without JavaScript). Keyset cursors
 * only go forward, so "previous" returns to the first page.
 */
export function Pagination({ basePath, params, hasNextPage, endCursor, isFirstPage }: Props) {
  const firstParams = new URLSearchParams(params);
  firstParams.delete('after');
  const firstQuery = firstParams.toString();
  const nextParams = new URLSearchParams(firstParams);
  if (endCursor) nextParams.set('after', endCursor);

  return (
    <nav className="pagination" aria-label="Pagination">
      {!isFirstPage && <Link href={`${basePath}${firstQuery ? `?${firstQuery}` : ''}`}>First page</Link>}
      {hasNextPage && endCursor && (
        <Link href={`${basePath}?${nextParams.toString()}`} rel="next">
          Next page
        </Link>
      )}
    </nav>
  );
}
