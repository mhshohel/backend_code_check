// Injection tokens. Every constructor dependency is injected by token with
// @Inject(...): tsx and esbuild do not emit decorator type metadata, so Nest
// cannot infer dependencies from parameter types.
export const SERVICES = Symbol('Services');
export const APP_OPTIONS = Symbol('AppOptions');
export const GRAPHQL_SCHEMA = Symbol('GraphQLSchema');
export const YOGA = Symbol('Yoga');
export const RATE_LIMITERS = Symbol('RateLimiters');
