import type { Response } from 'express';

/** Error body of every non-GraphQL route: { error, correlationId }. */
export function sendError(res: Response, status: number, message: string): void {
  res.status(status).json({ error: message, correlationId: res.locals.correlationId });
}

/** GraphQL-shaped error for /graphql, so clients read extensions.code as usual. */
export function sendGraphQLError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ errors: [{ message, extensions: { code, correlationId: res.locals.correlationId } }] });
}
