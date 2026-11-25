import { badInput, decodeCursor, encodeCursor, pageSize, type KeysetCursor } from '@ofl/domain';

export type Edge<T> = { cursor: string; node: T };
export type Page<T> = { edges: Edge<T>[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };

export type PageRequest = { limit: number; after: KeysetCursor | null };

export function pageRequest(first: number | null | undefined, after: string | null | undefined): PageRequest {
  return { limit: pageSize(first), after: decodeCursor(after) };
}

/**
 * Builds a connection page from rows fetched with LIMIT limit + 1. The
 * extra row only tells whether another page exists.
 */
export function toPage<T>(rows: readonly T[], limit: number, keyOf: (row: T) => KeysetCursor): Page<T> {
  const visible = rows.slice(0, limit);
  const edges = visible.map((node) => ({ cursor: encodeCursor(keyOf(node)), node }));
  return {
    edges,
    pageInfo: { hasNextPage: rows.length > limit, endCursor: edges.at(-1)?.cursor ?? null },
  };
}

/** PostgreSQL expression that renders a timestamptz with microseconds, for exact keyset cursors. */
export function timestampCursorSql(column: string): string {
  return `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

const BIGINT_ID = /^\d{1,18}$/;
const UUID_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Rejects a forged cursor before its values reach a typed SQL parameter. */
export function assertCursorId(page: PageRequest, kind: 'bigint' | 'uuid'): void {
  if (!page.after) return;
  const valid = kind === 'bigint' ? BIGINT_ID.test(page.after.id) : UUID_ID.test(page.after.id);
  if (!valid) throw badInput('The cursor is not valid.', [{ path: 'after', message: 'Invalid cursor.' }]);
}
