import { badInput } from './errors';

// Opaque keyset cursors. A cursor stores the sort key of the last row seen
// plus the row id as a tie-breaker, so pages stay stable when new rows arrive.

export type KeysetCursor = { readonly sortKey: string; readonly id: string };

export function encodeCursor(cursor: KeysetCursor): string {
  return Buffer.from(JSON.stringify([cursor.sortKey, cursor.id]), 'utf8').toString('base64url');
}

export function decodeCursor(value: string | null | undefined): KeysetCursor | null {
  if (value === null || value === undefined || value === '') return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (Array.isArray(parsed) && parsed.length === 2 && typeof parsed[0] === 'string' && typeof parsed[1] === 'string') {
      return { sortKey: parsed[0], id: parsed[1] };
    }
  } catch {
    // Fall through to the error below.
  }
  throw badInput('The cursor is not valid.', [{ path: 'after', message: 'Invalid cursor.' }]);
}
