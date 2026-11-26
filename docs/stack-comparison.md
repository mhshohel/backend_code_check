# Stack comparison: Express, Fastify, Next.js, NestJS

All four variants serve the same GraphQL contract from the same application
layer (`@ofl/server-core`) and pass the same 14 acceptance scenarios. The
differences below are therefore differences of framework mechanics, not of
business behavior.

## 1. Summary

| Concern | Express 5 | Fastify 5 | Next.js 16 (App Router) | NestJS 12 (Express platform) |
| --- | --- | --- | --- | --- |
| Composition model | Ordered middleware chain | Plugin tree with encapsulation + lifecycle hooks | File-system routes, layouts, route handlers, Server Actions | Modules, controllers, providers with dependency injection |
| Where order matters | `app.use` order in one file | Hook phase (`onRequest`, `preValidation`, `preHandler`, …) and plugin scope | Rendering boundary (server vs client) and route segment config | Fixed lifecycle: middleware → guards → interceptors → pipes → handler → filters |
| Request validation | Manual (or middleware) | Built-in JSON Schema on routes | Manual in route handlers / actions | Pipes (not used: server-core validates with zod) |
| Raw body for the webhook | `express.raw()` on one route | Scoped content-type parser | `await request.text()` | `bodyParser: false` + `express.raw()` as middleware bound to one route |
| GraphQL over HTTP | `yoga(req, res, ctx)` as middleware | `yoga.handleNodeRequestAndResponse` + `reply.send` | Yoga's fetch handler in a route handler | Yoga instance (provider) called from a controller with `@Res()` |
| WebSocket subscriptions | `ws` server on the same HTTP server | `@fastify/websocket` route with `wsHandler` | Separate realtime process (route handlers cannot upgrade) | `ws` on Nest's HTTP server, attached by a provider's lifecycle hook |
| Logging | pino added as middleware | pino built in (`request.log`, `genReqId`) | pino from server-core | pino from server-core; Nest's own logs bridged with a `LoggerService` |
| Graceful shutdown | Own signal handler, close HTTP + ws + services | `fastify.close()` runs `onClose` hooks | `next start` process + own handlers for realtime and worker | `app.close()`: `beforeApplicationShutdown` → HTTP close → `onApplicationShutdown` |
| UI | Shared SPA (`packages/web-spa`) | Shared SPA | Server Components + client components | Shared SPA |

## 2. Express

Entry: [`implementations/express/api/app.ts`](../implementations/express/api/app.ts).

The whole request pipeline is one ordered list. The file comment states the
order and the reason for each position:

```ts
app.use(correlationId);                 // before anything can log
app.use(httpMetrics(services));         // measures everything below
app.use(securityHeaders(production));   // helmet
app.use(corsAllowlist(options.allowedOrigins));
app.use(healthRoutes(services));        // probes: no session, no rate limit
app.use('/webhooks', webhookRoutes(...));               // raw body, signature auth
app.use(['/auth', '/graphql'], cookieParser(), sessionMiddleware(services));
app.use('/auth', authRoutes(...));
app.use(graphqlRoutes(services, schema, ...));
```

What to notice:

- **Order is the security model.** The webhook is mounted before the cookie and
  session middleware, so it can never be authenticated by a cookie.
- **Per-route body parsing.** The webhook uses `express.raw()` because the HMAC
  covers the exact bytes ([`routes/webhooks.ts`](../implementations/express/api/routes/webhooks.ts)).
  GraphQL uses `express.json({ limit })`.
- **Yoga integration detail.** Calling `yoga(req, res, { req, res })` writes the
  response. `handleNodeRequestAndResponse` only returns a `Response` and leaves
  the request hanging in Express. This was found during integration.
- **CORS pitfall.** When the `cors` package rejects an origin it calls `next()`
  without CORS headers. Yoga's own CORS then echoed any origin. Yoga CORS is
  therefore disabled (`cors: false`) and a test covers the case.
- **Shutdown is manual** ([`shutdown.ts`](../implementations/express/api/shutdown.ts),
  [`http-server.ts`](../implementations/express/api/http-server.ts)): stop
  accepting, dispose the graphql-ws server, close services, with a timeout.

## 3. Fastify

Entry: [`implementations/fastify/api/build-server.ts`](../implementations/fastify/api/build-server.ts).

The pipeline is a tree of plugins. A plugin registered inside a scope affects
only that scope:

```
root: services, request context, security, metrics, websocket, health
├─ browser API scope: session hook + CSRF check
│   ├─ /auth
│   └─ /graphql (Yoga HTTP + graphql-ws)
├─ /webhooks scope: raw-body JSON parser
└─ SPA static files + not-found fallback
```

What to notice:

- **Encapsulation replaces ordering.** The session hook and the CSRF check live
  in the browser API scope, so the webhook and static files never run them, no
  matter the registration order. `fastify-plugin` is used only where a
  decorator must be visible to the whole app.
- **Lifecycle phases.** The CSRF check runs in `preValidation`, so a request
  without `x-ofl-csrf` gets 403 before schema validation can answer 400.
- **Schema validation is built in.** The webhook route declares a JSON Schema
  ([`routes/webhook.ts`](../implementations/fastify/api/routes/webhook.ts));
  Fastify rejects bad bodies before the handler runs.
- **Scoped content-type parser.** The webhook scope replaces the JSON parser with
  one that keeps the raw string. Other scopes keep the default parser.
- **Logging and request IDs are built in.** `genReqId` takes the incoming
  `x-correlation-id`; `request.log` carries it automatically.
- **Shutdown through the framework.** `fastify.close()` waits for in-flight
  requests, then runs `onClose` hooks (graphql-ws dispose, `closeServices`).
- **One path, two protocols.** `GET /graphql` serves Yoga for normal requests
  and graphql-ws for upgrades through the route's `wsHandler`
  ([`routes/graphql.ts`](../implementations/fastify/api/routes/graphql.ts)).

## 4. Next.js

Entry points: [`app/`](../implementations/nextjs/app) (pages, layouts, route
handlers) and [`modules/server/`](../implementations/nextjs/modules/server)
(server-only code). Full walkthrough:
[`implementations/nextjs/README.md`](../implementations/nextjs/README.md).

There is no request pipeline to order. Each concern lives at a boundary that
the framework defines:

| Concern | Where | File |
| --- | --- | --- |
| Public pages (catalog, product) | Server Components call the application layer in-process | [`modules/server/data/run-operation.ts`](../implementations/nextjs/modules/server/data/run-operation.ts) |
| Mutations from the browser | Client components send GraphQL to a route handler | [`app/api/graphql/route.ts`](../implementations/nextjs/app/api/graphql/route.ts) |
| Login, logout, price change | Server Actions (`cookies()` API) | [`modules/auth/actions.ts`](../implementations/nextjs/modules/auth/actions.ts), [`modules/admin/actions.ts`](../implementations/nextjs/modules/admin/actions.ts) |
| CSRF, rate limit, body limit | A wrapper around each route handler (`withGuards`) | [`modules/server/http/guards.ts`](../implementations/nextjs/modules/server/http/guards.ts) |
| Access checks for pages | Segment layouts (`redirect`, `forbidden`, `notFound`) | `app/orders`, `app/warehouse`, `app/admin` layouts |
| Subscriptions | A separate Node process with graphql-ws | [`modules/realtime/server.ts`](../implementations/nextjs/modules/realtime/server.ts) |

What to notice:

- **No HTTP call to itself.** A Server Component runs `executeOperation`
  against the shared schema in the same process. The result is copied with
  `structuredClone`, because graphql-js returns null-prototype objects that
  React refuses to pass to client components.
- **Caching is a decision per data source.** Anonymous search results use
  `unstable_cache` for 15 s with the index prefix in the key; categories for
  300 s. Anything that reads the session is dynamic and sent with
  `Cache-Control: private, no-store`. The admin price action calls
  `revalidateTag`; client mutations call `router.refresh()`.
- **Loading boundaries change status codes.** A root `loading.tsx` starts a
  streamed response with status 200 before the page can redirect or return 403.
  Loading files therefore live in route groups below the access checks.
- **Bundling has consequences.** Route handlers and Server Components are
  separate bundles with separate copies of workspace modules. `instanceof`
  failed across them, so `AppError` carries a global symbol brand.
- **No client IP without a proxy.** Route handlers see headers only, and
  `X-Forwarded-For` is client-controlled unless a trusted proxy sets it.
  `TRUST_PROXY` decides which key the rate limiter uses.
- **No WebSocket upgrade in route handlers.** The realtime service runs on its
  own port; cookies are host-scoped, so the browser still sends the session.

## 5. NestJS

Entry: [`implementations/nestjs/api/app.module.ts`](../implementations/nestjs/api/app.module.ts)
and [`create-app.ts`](../implementations/nestjs/api/create-app.ts). Full
walkthrough: [`implementations/nestjs/README.md`](../implementations/nestjs/README.md).
Decisions: [ADR 0010](decisions/0010-nestjs-variant.md).

The same Express 5 underneath, organized by NestJS:

| Stage | Applied to | Code |
| --- | --- | --- |
| Express middleware (`app.use`) | every request | correlation id, metrics, helmet, CORS |
| Nest middleware (`configure()`) | per controller | cookie + session for `/auth`, `/graphql`; JSON parser; raw parser for the webhook |
| Guards (`@UseGuards`) | per controller | `CsrfGuard`, `RateLimitGuard` (configured by `@RateLimit`, `@GraphQLErrors` metadata) |
| Handler | – | one call into server-core, or Yoga for `/graphql` |
| Exception filter (`APP_FILTER`) | everything | one error format; Nest's 404; SPA fallback in production |

What to notice:

- **Structure replaces ordering.** Which middleware and guards a route gets is
  declared next to the controller, not by position in one list. The order
  *between* kinds is fixed by Nest: middleware always before guards. So the
  body is parsed before the CSRF and rate-limit checks, unlike Express.
- **Global concerns are still Express middleware.** Nest middleware and
  interceptors only see requests that reach the router; CORS preflights,
  404s and body-parser errors would bypass them.
- **Errors from middleware must be thrown.** An Express body parser reports
  errors with `next(err)`, which would skip the Nest exception filter; the
  wrapper turns it into a thrown error.
- **DI without type metadata.** tsx and esbuild do not emit
  `design:paramtypes`, so every dependency is injected by an explicit token.
- **No `@nestjs/graphql`, no gateway.** The schema and resolvers already live
  in server-core, and the SPA speaks graphql-ws. Yoga runs behind a
  controller; graphql-ws is attached in `onApplicationBootstrap`.
- **Lifecycle hooks give the drain order.** `app.close()` closes WebSockets,
  then the HTTP server, then the services — the same order the Express variant
  writes by hand.

## 6. When to choose which

| Situation | Better fit | Reason |
| --- | --- | --- |
| Small API, team knows Express, many existing middlewares | Express | Lowest learning cost; huge ecosystem. |
| API with many routes, strict input validation, high request rate | Fastify | Schema validation, encapsulation, built-in logging, lower overhead per request. |
| Public content that must render fast and be indexed, plus interactive areas | Next.js | Server rendering and streaming for public pages, client components for workflows. |
| Long-lived WebSocket connections at scale | Express or Fastify (or a dedicated service) | Next.js route handlers cannot upgrade connections; a separate process is needed anyway. |
| Large API, several teams, many cross-cutting rules | NestJS | Modules and DI give a fixed place for every concern; guards, filters and providers are reusable and testable in isolation. Costs: decorators, a DI container, and its own lifecycle to learn. |

These are tendencies, not rules. In this lab the business code is identical, so
the measurable difference between Express and Fastify is the HTTP overhead;
see [performance.md](performance.md).
