# NestJS variant

The order fulfillment platform served by [NestJS 12](https://nestjs.com/) on
its Express platform (`@nestjs/platform-express`, Express 5.3). Business logic
lives in [`@ofl/server-core`](../../packages/server-core); this folder only
contains the HTTP layer (modules, controllers, middleware, guards, an
exception filter), the worker entry, the SPA host, and tests. The browser app
is the shared [`@ofl/web-spa`](../../packages/web-spa).

| Process | Port | Entry |
| --- | --- | --- |
| API (HTTP + GraphQL + WebSocket + SPA in production) | 9011 | [`api/main.ts`](api/main.ts) |
| Web dev server (Vite, proxies to the API) | 9012 | [`web/vite.config.ts`](web/vite.config.ts) |
| Worker (outbox jobs) + health/metrics | 9013 | [`worker/main.ts`](worker/main.ts) |

Resources: database `ofl_nestjs` (tests: `ofl_nestjs_test`), Elasticsearch
prefix `ofl_nestjs_` (tests: `ofl_nestjs_test_`).

## Run it

```sh
# once, from the repository root
make setup          # or: pnpm install && pnpm db:create

make nestjs-seed    # migrate, empty the database, load the demo profile
make nestjs-dev     # API :9011, worker :9013, Vite :9012 -> open http://localhost:9012
make nestjs-start   # production build, then the API serves web/dist at http://localhost:9011
make nestjs-test    # HTTP + lifecycle tests and the 14 acceptance scenarios
make nestjs-check   # type check and lint
```

Inside this folder the same commands are `pnpm reset`, `pnpm dev`,
`pnpm build && pnpm start`, `pnpm test`, `pnpm typecheck`, `pnpm lint`.

## Tests

`pnpm test` runs, against `ofl_nestjs_test` and a real Elasticsearch:

- [`tests/http.test.ts`](tests/http.test.ts): the same HTTP contract the
  Express variant checks (cookie flags, CSRF, CORS, rate limits with
  `RateLimit-Policy` headers, 100 KB limit on every JSON media type, 415 for
  non-JSON GraphQL bodies, error format, webhook signature, WebSocket Origin
  check, metrics labels), plus NestJS-specific checks: `app.close()` closes
  WebSockets with 1001, then the HTTP server, then the services; the webhook
  runs neither the CSRF guard nor the session middleware; Nest's own 404 goes
  through the exception filter with a correlation id.
- [`tests/acceptance.test.ts`](tests/acceptance.test.ts): the shared 14
  scenarios from [`@ofl/test-contracts`](../../packages/test-contracts). Each
  instance (primary, S14 second instance, S13 search-down instance) is a full
  Nest app from `createNestApp()` listening on port 0.

One scenario: `make test-scenario VARIANT=nestjs S=S9`.

## Code walkthrough

### Request lifecycle

NestJS fixes the order of the stages; the code decides which stages apply to
which controller.

| Stage | What runs here | File |
| --- | --- | --- |
| 1. Express middleware (`app.use`, all requests) | correlation id → metrics → helmet → CORS (`app.enableCors`) → static files in production | [`api/create-app.ts`](api/create-app.ts) |
| 2. Nest middleware (per controller) | `/auth`, `/graphql`: cookie-parser, `SessionMiddleware`; `/auth`: `JsonBodyMiddleware`; `/graphql`: `RequireJsonBodyMiddleware` (415), `JsonBodyMiddleware`; `/webhooks/payments`: `RawBodyMiddleware` | [`api/app.module.ts`](api/app.module.ts) `configure()` |
| 3. Guards (`@UseGuards`) | `/auth`: `CsrfGuard`, `RateLimitGuard`; `/graphql`: `RateLimitGuard`, `CsrfGuard`; `/webhooks`: `RateLimitGuard` | [`api/common/csrf.guard.ts`](api/common/csrf.guard.ts), [`api/common/rate-limit.guard.ts`](api/common/rate-limit.guard.ts) |
| 4. Handler | one call into `@ofl/server-core` | `api/*/*.controller.ts` |
| 5. Exception filter (`APP_FILTER`) | every error from stages 2–4 and Nest's own 404 → `{ error, correlationId }`, or GraphQL-shaped errors for `/graphql` guards, or `index.html` for SPA routes in production | [`api/common/http-exception.filter.ts`](api/common/http-exception.filter.ts) |

Things to notice:

- **Global concerns stay plain Express middleware.** A Nest interceptor or
  module middleware only runs for requests that reach the router; CORS
  preflights, 404s and body-parser errors would be missed. `app.use()` before
  `init()` puts them ahead of Nest's router, which is also how the Nest docs
  add helmet.
- **Body parsing is per controller.** The app is created with
  `bodyParser: false`. Each controller gets exactly one parser through
  `MiddlewareConsumer`, the webhook gets raw bytes for the HMAC.
- **Middleware errors must be thrown.** Body parsers report errors with
  `next(err)`, which Express would hand to its own error handler and skip the
  Nest filter. [`api/common/body.middleware.ts`](api/common/body.middleware.ts)
  wraps the parser in a promise and throws instead.
- **Middleware runs before guards.** Unlike the Express variant, the body is
  parsed (bounded at 100 KB) before the rate limit and CSRF guards run. The
  response for any given request is the same; the order of the work differs.
- **Guards are configured with metadata.** `@RateLimit('login')` and
  `@GraphQLErrors()` are `SetMetadata` decorators read with `Reflector`.
  `RateLimitGuard` delegates the counting to `express-rate-limit`, so the
  `RateLimit` and `RateLimit-Policy` headers match the Express variant.

### Dependency injection without type metadata

`tsx` (dev) and `esbuild` (build) compile TypeScript decorators but cannot
emit `design:paramtypes`, the metadata Nest normally uses to infer
constructor dependencies. Every constructor parameter therefore names its
token explicitly, for example `@Inject(SERVICES)` or `@Inject(Reflector)`.
Tokens are in [`api/tokens.ts`](api/tokens.ts). `tsconfig.json` enables
`experimentalDecorators` only; the Jest config enables legacy decorators in
SWC.

### Modules and providers

- [`api/core/core.module.ts`](api/core/core.module.ts): global `CoreModule`
  with an async factory provider for `Services` (`createServices`), and
  `onApplicationShutdown` closing them.
- [`api/app.module.ts`](api/app.module.ts): dynamic `AppModule.forRoot(config,
  options)` with the controllers, the GraphQL schema and Yoga providers, the
  WebSocket service, guards, the rate limiters and the global filter.
- [`worker/worker.module.ts`](worker/worker.module.ts): `CoreModule`, the
  `HealthController` for probes, and `WorkerRunner`.

### GraphQL and subscriptions

[`api/graphql/yoga.provider.ts`](api/graphql/yoga.provider.ts) builds one
executable schema with `buildGraphQLSchema(services)` and a GraphQL Yoga
instance over it. [`api/graphql/graphql.controller.ts`](api/graphql/graphql.controller.ts)
hands `/graphql` to Yoga with `@Res()`, so Yoga writes the response.

`@nestjs/graphql` is not used on purpose: its resolvers are Nest classes, and
the resolvers already exist in `@ofl/server-core`. Re-declaring them would
duplicate the schema layer in framework code.

[`api/graphql/graphql-ws.service.ts`](api/graphql/graphql-ws.service.ts)
attaches graphql-ws to the HTTP server Nest created (`HttpAdapterHost`) in
`onApplicationBootstrap`. It is a provider, not a `@WebSocketGateway`: Nest
gateways use their own message format, while the SPA speaks the graphql-ws
protocol. Upgrades bypass Nest middleware and guards, so the service checks
the Origin allowlist and resolves the session cookie itself.

### Shutdown

[`api/main.ts`](api/main.ts) binds SIGTERM/SIGINT with the same handler as
the other variants (second signal and 15 s timeout exit immediately) and calls
`app.close()`. Nest then runs the hooks in this order:

1. `beforeApplicationShutdown`: close WebSockets with 1001 (API) or
   `worker.stop()`, which finishes in-flight jobs (worker);
2. close the HTTP server;
3. `onApplicationShutdown`: `closeServices` (database pool, LISTEN
   connection, search client).

### Worker

[`worker/main.ts`](worker/main.ts) creates a Nest app from `WorkerModule` and
listens on :9013 for `/health/live`, `/health/ready` and `/metrics`.
`WorkerRunner` starts the shared outbox worker in `onApplicationBootstrap`.

### Build

[`scripts/build.mjs`](scripts/build.mjs) bundles `api/main.ts` and
`worker/main.ts` with esbuild (decorators included). Workspace packages are
bundled; `node_modules` packages stay external.

## Differences from the Express variant

Both run on Express 5.3, so the HTTP details (helmet, cors, body parsers,
express-rate-limit) are the same libraries. The difference is structure.

| Concern | Express | NestJS |
| --- | --- | --- |
| Composition | One ordered `app.use` list in `app.ts` | Modules; middleware bound per controller in `configure()`; guards per controller |
| Where order is decided | The line order of `app.use` | Fixed lifecycle: middleware → guards → interceptors → pipes → handler → filters |
| Per-request data | `res.locals` | `res.locals` (same Express objects) |
| Dependencies | Function arguments (`createApp(services, options)`) | Injection by token, providers, async factory for `Services` |
| Errors | Error middleware with four arguments, last | One global `ExceptionFilter`; middleware errors must be thrown, not passed to `next` |
| Raw body for webhook | `express.raw()` on one route | `RawBodyMiddleware` bound to `POST webhooks/payments`, app created with `bodyParser: false` |
| WebSocket | `ws` on the `upgrade` event | Same, attached in a provider's `onApplicationBootstrap` |
| Shutdown | Hand-written drain sequence | `app.close()` and lifecycle hooks |
| Startup | Build the app and listen | Nest scans modules and builds the DI container first |
