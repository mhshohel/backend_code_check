// Cross-cutting application errors. They map to GraphQL errors with
// extensions.code. Expected business outcomes (for example insufficient
// stock) are NOT errors; they are result union members.

export type AppErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'BAD_USER_INPUT'
  | 'QUERY_TOO_COMPLEX'
  | 'SEARCH_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'CONFLICT'
  | 'INTERNAL_SERVER_ERROR';

export type FieldError = { readonly path: string; readonly message: string };

// Bundlers such as Next.js can load two copies of this module in one process,
// so `instanceof` may compare against a different class. A global symbol
// brand identifies an AppError from any copy.
const APP_ERROR_BRAND = Symbol.for('ofl.AppError');

export class AppError extends Error {
  readonly [APP_ERROR_BRAND] = true;

  constructor(
    readonly code: AppErrorCode,
    message: string,
    readonly fieldErrors: readonly FieldError[] = [],
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const unauthenticated = () => new AppError('UNAUTHENTICATED', 'Sign in to continue.');
export const forbidden = () => new AppError('FORBIDDEN', 'You do not have permission for this action.');
export const notFound = (what: string) => new AppError('NOT_FOUND', `${what} was not found.`);
export const badInput = (message: string, fieldErrors: readonly FieldError[] = []) =>
  new AppError('BAD_USER_INPUT', message, fieldErrors);

export function isAppError(error: unknown): error is AppError {
  if (error instanceof AppError) return true;
  return typeof error === 'object' && error !== null && (error as Record<symbol, unknown>)[APP_ERROR_BRAND] === true;
}
