# Stack comparison: Express, Fastify, Next.js

All three variants serve the same GraphQL contract from the same application
layer (`@ofl/server-core`) and pass the same 14 acceptance scenarios. The
differences below are therefore differences of framework mechanics, not of
business behavior.

## 1. Summary

| Concern | Express 5 | Fastify 5 | Next.js 16 (App Router) |
| --- | --- | --- | --- |
| Composition model | Ordered middleware chain | Plugin tree with encapsulation + lifecycle hooks | File-system routes, layouts, route handlers, Server Actions |
| Where order matters | `app.use` order in one file | Hook phase (`onRequest`, `preValidation`, `preHandler`, …) and plugin scope | Rendering boundary (server vs client) and route segment config |
| Request validation | Manual (or middleware) | Built-in JSON Schema on routes | Manual in route handlers / actions |
| Raw body for the webhook | `express.raw()` on one route | Scoped content-type parser | `await request.text()` |
| GraphQL over HTTP | `yoga(req, res, ctx)` as middleware | `yoga.handleNodeRequestAndResponse` + `reply.send` | Yoga's fetch handler in a route handler |
| WebSocket subscriptions | `ws` server on the same HTTP server | `@fastify/websocket` route with `wsHandler` | Separate realtime process (route handlers cannot upgrade) |
| Logging | pino added as middleware | pino built in (`request.log`, `genReqId`) | pino from server-core |
| Graceful shutdown | Own signal handler, close HTTP + ws + services | `fastify.close()` runs `onClose` hooks | `next start` process + own handlers for realtime and worker |
| UI | Shared SPA (`packages/web-spa`) | Shared SPA | Server Components + client components |

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

Added after the Next.js variant is complete. See
[`implementations/nextjs/README.md`](../implementations/nextjs/README.md).

## 5. When to choose which

| Situation | Better fit | Reason |
| --- | --- | --- |
| Small API, team knows Express, many existing middlewares | Express | Lowest learning cost; huge ecosystem. |
| API with many routes, strict input validation, high request rate | Fastify | Schema validation, encapsulation, built-in logging, lower overhead per request. |
| Public content that must render fast and be indexed, plus interactive areas | Next.js | Server rendering and streaming for public pages, client components for workflows. |
| Long-lived WebSocket connections at scale | Express or Fastify (or a dedicated service) | Next.js route handlers cannot upgrade connections; a separate process is needed anyway. |

These are tendencies, not rules. In this lab the business code is identical, so
the measurable difference between Express and Fastify is the HTTP overhead;
see [performance.md](performance.md).
