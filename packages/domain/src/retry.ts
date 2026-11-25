// Retry classification for transactions and worker jobs.
// RETRYABLE: the same operation can succeed later without any change.
// PERMANENT: retrying repeats the same failure, so the job goes to FAILED.

export type RetryDecision = 'RETRYABLE' | 'PERMANENT';

// PostgreSQL SQLSTATE codes. See https://www.postgresql.org/docs/current/errcodes-appendix.html
const RETRYABLE_SQLSTATES = new Set([
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '55P03', // lock_not_available
  '57014', // query_canceled (statement_timeout)
  '53300', // too_many_connections
  '08006', // connection_failure
  '08001', // sqlclient_unable_to_establish_sqlconnection
]);

const RETRYABLE_NETWORK_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN']);

const RETRYABLE_HTTP_STATUS = new Set([408, 429, 502, 503, 504]);

type ErrorShape = { code?: unknown; statusCode?: unknown; meta?: { statusCode?: unknown }; retryable?: unknown };

export function classifyError(error: unknown): RetryDecision {
  if (typeof error !== 'object' || error === null) return 'PERMANENT';
  const shape = error as ErrorShape;

  if (typeof shape.retryable === 'boolean') {
    return shape.retryable ? 'RETRYABLE' : 'PERMANENT';
  }
  if (typeof shape.code === 'string') {
    if (RETRYABLE_SQLSTATES.has(shape.code) || RETRYABLE_NETWORK_CODES.has(shape.code)) {
      return 'RETRYABLE';
    }
  }
  const status = typeof shape.statusCode === 'number' ? shape.statusCode : shape.meta?.statusCode;
  if (typeof status === 'number' && RETRYABLE_HTTP_STATUS.has(status)) {
    return 'RETRYABLE';
  }
  // Elasticsearch client connection errors have names but no codes.
  if (error instanceof Error && (error.name === 'ConnectionError' || error.name === 'TimeoutError')) {
    return 'RETRYABLE';
  }
  return 'PERMANENT';
}

/** True for errors that a short in-request transaction retry can fix. */
export function isTransactionConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as ErrorShape).code;
  return code === '40001' || code === '40P01';
}

export type BackoffOptions = { baseMs: number; maxMs: number; random?: () => number };

/**
 * Exponential backoff with "full jitter": a random delay between 0 and
 * min(maxMs, baseMs * 2^attempt). Jitter spreads retries from many workers.
 */
export function backoffDelayMs(attempt: number, options: BackoffOptions): number {
  const random = options.random ?? Math.random;
  const ceiling = Math.min(options.maxMs, options.baseMs * 2 ** Math.max(0, attempt));
  return Math.floor(random() * ceiling);
}
