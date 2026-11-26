# ADR 0010: NestJS variant on the shared layer

## Status
Accepted (2026-11-26).

## Context
A fourth variant was added with NestJS 12. Its idiomatic stack would be
`@nestjs/graphql` (resolver classes), `@nestjs/throttler`, global body
parsing, `@WebSocketGateway` and `emitDecoratorMetadata` for dependency
injection. Several of these conflict with rules of this lab: business code and
the GraphQL schema live once in `@ofl/server-core` (ADR 0005), the webhook
needs the raw body (ADR 0006), the SPA speaks the graphql-ws protocol, and the
repository compiles TypeScript with tsx, esbuild and SWC, not `tsc`.

## Decision
1. **Platform:** `@nestjs/platform-express` (Express 5.3), so the HTTP details
   (helmet, cors, body parsers, express-rate-limit) are the same libraries as
   the Express variant and only the structure differs.
2. **GraphQL:** a controller hands `/graphql` to a GraphQL Yoga instance built
   over `buildGraphQLSchema(services)`. `@nestjs/graphql` is not used.
3. **Subscriptions:** graphql-ws attached to Nest's HTTP server by a provider
   in `onApplicationBootstrap`, closed in `beforeApplicationShutdown`. No
   `@WebSocketGateway`.
4. **Body parsing:** `bodyParser: false`; one parser per controller through
   `MiddlewareConsumer` (JSON for `/auth` and `/graphql`, raw for the webhook).
5. **Rate limits and CSRF:** guards configured with `SetMetadata` decorators.
   The rate-limit guard delegates to express-rate-limit instead of
   `@nestjs/throttler`, to keep the same counting and `RateLimit-*` headers.
6. **Dependency injection:** explicit `@Inject(TOKEN)` on every constructor
   parameter; `experimentalDecorators` on, `emitDecoratorMetadata` off.
7. **Global concerns** (correlation id, metrics, helmet, CORS) are Express
   middleware added with `app.use()` before `init()`, so they also see
   preflights, 404s and body-parser errors.

## Alternatives considered
- `@nestjs/graphql` with schema-first resolvers delegating to server-core:
  duplicates every resolver signature in framework code and splits the
  schema across two packages. Rejected.
- Fastify platform for Nest: would compare Nest-on-Fastify with plain
  Fastify; the Express platform isolates "Nest structure vs plain Express".
- `tsc` with `emitDecoratorMetadata` for builds: a different compiler for one
  package, and Jest/tsx would still need explicit tokens. Rejected.
- `@nestjs/throttler`: named throttlers apply to every route unless skipped,
  and its headers differ from the other variants.

## Consequences
- Middleware runs before guards in Nest: the body is parsed (bounded at
  100 KB) before the CSRF and rate-limit checks. Responses are identical to
  the Express variant; the order of work differs.
- Body-parser errors must be thrown inside Nest middleware; `next(err)` would
  skip the exception filter.
- Every injectable class lists its tokens explicitly. Forgetting `@Inject`
  shows up at boot as an "unknown dependency" error, not at compile time.
