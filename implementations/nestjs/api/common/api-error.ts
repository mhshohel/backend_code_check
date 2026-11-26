/**
 * An HTTP error raised by our guards and middleware. The global exception
 * filter turns it into { error, correlationId }, or into a GraphQL-shaped
 * { errors: [...] } body when `graphqlCode` is set (routes under /graphql),
 * so GraphQL clients read extensions.code as usual.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly graphqlCode?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
