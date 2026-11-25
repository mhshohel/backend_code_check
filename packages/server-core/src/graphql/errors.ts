import { GraphQLError } from 'graphql';
import { isAppError, type AppError, type AppErrorCode } from '@ofl/domain';
import type { Logger } from '../observability/logger';

const KNOWN_CODES = new Set<string>([
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'BAD_USER_INPUT',
  'QUERY_TOO_COMPLEX',
  'SEARCH_UNAVAILABLE',
  'RATE_LIMITED',
  'CONFLICT',
  'INTERNAL_SERVER_ERROR',
]);

function findAppError(error: unknown): AppError | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (isAppError(current)) return current;
    current = current instanceof GraphQLError ? current.originalError : null;
  }
  return null;
}

function rootCause(error: GraphQLError): unknown {
  let current: unknown = error;
  while (current instanceof GraphQLError && current.originalError) current = current.originalError;
  return current;
}

/**
 * Turns any execution error into the public error model:
 * AppError -> its code (plus fieldErrors); request errors (validation,
 * variable coercion) -> BAD_USER_INPUT; anything else -> INTERNAL_SERVER_ERROR
 * with a generic message. Internals are logged, never returned.
 */
export function toClientError(error: GraphQLError, logger: Logger, correlationId?: string): GraphQLError {
  const appError = findAppError(error);
  if (appError) {
    return new GraphQLError(appError.message, {
      nodes: error.nodes,
      path: error.path,
      extensions: {
        code: appError.code,
        ...(appError.fieldErrors.length > 0 ? { fieldErrors: appError.fieldErrors } : {}),
      },
    });
  }

  const existingCode = typeof error.extensions.code === 'string' ? error.extensions.code : null;
  const cause = rootCause(error);
  const isResolverFailure = error.path !== undefined && cause !== error;
  if (!isResolverFailure) {
    const code = existingCode && KNOWN_CODES.has(existingCode) ? existingCode : 'BAD_USER_INPUT';
    return new GraphQLError(error.message, { nodes: error.nodes, path: error.path, extensions: { code } });
  }

  logger.error({ err: cause, path: error.path?.join('.'), correlationId }, 'unexpected GraphQL resolver error');
  return new GraphQLError('Internal server error.', {
    nodes: error.nodes,
    path: error.path,
    extensions: { code: 'INTERNAL_SERVER_ERROR', ...(correlationId ? { correlationId } : {}) },
  });
}

export function errorCode(error: GraphQLError): AppErrorCode {
  const code = error.extensions.code;
  return typeof code === 'string' && KNOWN_CODES.has(code) ? (code as AppErrorCode) : 'INTERNAL_SERVER_ERROR';
}
