import type { CombinedError } from '@urql/core';

export type FieldError = { readonly path: string; readonly message: string };

export type ClientErrorKind =
  | 'network'
  | 'unauthenticated'
  | 'forbidden'
  | 'not-found'
  | 'bad-input'
  | 'rate-limited'
  | 'unavailable'
  | 'unexpected';

export type DescribedError = {
  readonly kind: ClientErrorKind;
  readonly message: string;
  readonly fieldErrors: readonly FieldError[];
};

const MESSAGES: Record<ClientErrorKind, string> = {
  network: 'Could not reach the server. Check your connection and try again.',
  unauthenticated: 'Your session has ended. Sign in to continue.',
  forbidden: 'You do not have permission for this action.',
  'not-found': 'This item no longer exists or is not visible to you.',
  'bad-input': 'Some values are not valid.',
  'rate-limited': 'Too many requests. Wait a moment and try again.',
  unavailable: 'This feature is temporarily unavailable.',
  unexpected: 'Something went wrong. Try again.',
};

const KIND_BY_CODE: Record<string, ClientErrorKind> = {
  UNAUTHENTICATED: 'unauthenticated',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'not-found',
  BAD_USER_INPUT: 'bad-input',
  RATE_LIMITED: 'rate-limited',
  SEARCH_UNAVAILABLE: 'unavailable',
};

function isFieldError(value: unknown): value is FieldError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { path?: unknown }).path === 'string' &&
    typeof (value as { message?: unknown }).message === 'string'
  );
}

/** Maps a urql error to a user-facing description. Business outcomes are union members, not errors. */
export function describeError(error: CombinedError): DescribedError {
  if (error.networkError || error.graphQLErrors.length === 0) {
    const status = (error.response as { status?: number } | undefined)?.status;
    if (status === 429) return { kind: 'rate-limited', message: MESSAGES['rate-limited'], fieldErrors: [] };
    return { kind: 'network', message: MESSAGES.network, fieldErrors: [] };
  }
  const first = error.graphQLErrors[0];
  const code = typeof first?.extensions?.code === 'string' ? first.extensions.code : '';
  const kind = KIND_BY_CODE[code] ?? 'unexpected';
  const rawFieldErrors = first?.extensions?.fieldErrors;
  const fieldErrors = Array.isArray(rawFieldErrors) ? rawFieldErrors.filter(isFieldError) : [];
  const message = kind === 'bad-input' && first?.message ? first.message : MESSAGES[kind];
  return { kind, message, fieldErrors };
}
