import type { CombinedError } from '@urql/core';

export type FieldError = { path: string; message: string };

export type ErrorDescription = {
  code: string;
  message: string;
  fieldErrors: FieldError[];
};

const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: 'Please sign in to continue.',
  FORBIDDEN: 'Your account is not allowed to do this.',
  NOT_FOUND: 'We could not find that.',
  BAD_USER_INPUT: 'Some values are not valid.',
  QUERY_TOO_COMPLEX: 'The request was too large. Try a smaller page.',
  SEARCH_UNAVAILABLE: 'Search is temporarily unavailable. Product pages and checkout still work.',
  RATE_LIMITED: 'Too many requests. Wait a moment and try again.',
  INTERNAL_SERVER_ERROR: 'Something went wrong on our side. Please try again.',
};

function isFieldError(value: unknown): value is FieldError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).path === 'string' &&
    typeof (value as Record<string, unknown>).message === 'string'
  );
}

/** Maps a urql error to a code and a message that can be shown to users. */
export function describeError(error: CombinedError): ErrorDescription {
  if (error.networkError) {
    return {
      code: 'NETWORK_ERROR',
      message: 'We could not reach the server. Check your connection and try again.',
      fieldErrors: [],
    };
  }
  const first = error.graphQLErrors[0];
  const rawCode = first?.extensions.code;
  const code = typeof rawCode === 'string' ? rawCode : 'INTERNAL_SERVER_ERROR';
  const rawFields = first?.extensions.fieldErrors;
  const fieldErrors = Array.isArray(rawFields) ? rawFields.filter(isFieldError) : [];
  const message = code === 'BAD_USER_INPUT' && first?.message ? first.message : (MESSAGES[code] ?? MESSAGES.INTERNAL_SERVER_ERROR!);
  return { code, message, fieldErrors };
}
