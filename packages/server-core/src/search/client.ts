import { Client, errors } from '@elastic/elasticsearch';
import { AppError } from '@ofl/domain';

export function createSearchClient(url: string): Client {
  return new Client({
    node: url,
    // Short timeouts: search is optional for the shop to work, so a slow or
    // missing cluster must fail fast instead of tying up request handlers.
    requestTimeout: 3000,
    maxRetries: 1,
    sniffOnStart: false,
  });
}

export function searchUnavailable(cause: unknown): AppError {
  const error = new AppError('SEARCH_UNAVAILABLE', 'Search is temporarily unavailable. Please try again shortly.');
  error.cause = cause;
  return error;
}

export function isConnectivityError(error: unknown): boolean {
  return (
    error instanceof errors.ConnectionError ||
    error instanceof errors.TimeoutError ||
    error instanceof errors.NoLivingConnectionsError ||
    error instanceof errors.RequestAbortedError ||
    (error instanceof errors.ResponseError && (error.statusCode ?? 0) >= 500)
  );
}

export function isIndexMissing(error: unknown): boolean {
  return error instanceof errors.ResponseError && error.statusCode === 404;
}

export function isBadRequest(error: unknown): boolean {
  return error instanceof errors.ResponseError && error.statusCode === 400;
}

export function isVersionConflict(error: unknown): boolean {
  return error instanceof errors.ResponseError && error.statusCode === 409;
}
