# Fastify variant

The order fulfillment platform served by [Fastify 5](https://fastify.dev/).
Business logic lives in [`@ofl/server-core`](../../packages/server-core); this
folder only contains the HTTP layer, the worker entry, the SPA host, and tests.
The browser app is the shared [`@ofl/web-spa`](../../packages/web-spa).

| Process | Port | Entry |
| --- | --- | --- |
| API (HTTP + GraphQL + WebSocket + SPA in production) | 9005 | [`api/server.ts`](api/server.ts) |
| Web dev server (Vite, proxies to the API) | 9006 | [`web/vite.config.ts`](web/vite.config.ts) |
| Worker (outbox jobs) + health/metrics | 9007 | [`worker/main.ts`](worker/main.ts) |

Resources: database `ofl_fastify` (tests: `ofl_fastify_test`), Elasticsearch
prefix `ofl_fastify_` (tests: `ofl_fastify_test_`).

## Run it

```sh
# once, from the repository root
pnpm install
pnpm db:create

cd implementations/fastify
cp .env.example .env
pnpm reset          # migrate, empty the database, load the demo profile
pnpm dev            # API :9005, worker :9007, Vite :9006 -> open http://localhost:9006
```

Production-style run:

```sh
pnpm build          # vite build (web/dist) + esbuild bundles (dist/api, dist/worker)
pnpm start          # API serves web/dist at http://localhost:9005, plus the worker
```

Other scripts: `pnpm seed` (demo data), `pnpm typecheck`, `pnpm lint`,
`pnpm test`. Demo accounts are listed in
[requirements §12](../../docs/requirements.md#12-demo-accounts).

## Tests

`pnpm test` runs, against `ofl_fastify_test` and a real Elasticsearch:

- [`tests/http.test.ts`](tests/http.test.ts): HTTP behavior owned by this
  variant. Most cases use `fastify.inject()` (no socket, fast); WebSocket
  Origin checks use a real listening server. Covers cookie flags, CSRF,
  CORS, rate limits, body limit, webhook signature and body validation,
  health/readiness, metrics, and the error format. Readiness is decided by
  PostgreSQL only; an Elasticsearch outage is reported in `checks` but keeps
  200, because search is derived data and checkout does not need it.
- [`tests/acceptance.test.ts`](tests/acceptance.test.ts): the shared 14
  scenarios from [`@ofl/test-contracts`](../../packages/test-contracts). The
  second instance (S14) is another `buildServer()` with its own `Services`
  on another port; the search-down instance (S13) uses
  `ELASTICSEARCH_URL=http://127.0.0.1:9`.

## Code walkthrough

[`api/build-server.ts`](api/build-server.ts) builds the whole server and is
exported for tests. The comment at the top of `buildServer` shows the plugin
tree.

### Encapsulation and `fastify-plugin`

Fastify plugins create encapsulation contexts: decorators, hooks, and content
type parsers registered inside a plugin are visible only to that plugin and
its children. `fastify-plugin` (`fp`) removes the boundary. This server uses
`fp` only where something must reach every route:

| Plugin | `fp`? | Why |
| --- | --- | --- |
| [`plugins/services.ts`](api/plugins/services.ts) | yes | `fastify.services` decorator for every route; `onClose` hook closes the services. |
| [`plugins/request-context.ts`](api/plugins/request-context.ts) | yes | `request.correlationId` / `request.viewer` decorators and the correlation header on every response. |
| [`plugins/security.ts`](api/plugins/security.ts) | yes | Helmet headers, CORS, cookie parsing, and the rate limiter apply globally. |
| [`plugins/metrics.ts`](api/plugins/metrics.ts) | yes | `onResponse` latency histogram for all routes. |
| [`plugins/api-scope.ts`](api/plugins/api-scope.ts) | **no** | Session lookup (`onRequest`) and CSRF check (`preValidation`) apply only to `/auth` and `/graphql`. Static files and the webhook never touch the session table. |
| [`routes/webhook.ts`](api/routes/webhook.ts) | **no** | Replaces the JSON parser with a raw-string parser for the HMAC. Only this scope sees the replacement. |

### Hooks (request lifecycle)

1. `genReqId` (server option) validates `x-correlation-id` with
   `correlationIdFrom` or generates one. Fastify's logger puts it on every
   log line as `reqId`.
2. `onRequest` (global): copies the id to `request.correlationId` and the
   response header.
3. `onRequest` (rate limit, per route `config.rateLimit`): login 10/min,
   GraphQL 300/min, webhook 120/min per IP.
4. `onRequest` (API scope): reads `ofl_session` with `@fastify/cookie`, calls
   `resolveSession`, sets `request.viewer`.
5. `preValidation` (API scope): POST without `x-ofl-csrf: 1` gets 403. It
   runs before schema validation, so a cross-site request learns nothing
   about the body format.
6. Schema validation (Ajv) for the `POST /auth/login` body and the webhook
   signature header (the webhook body is validated by server-core after the
   signature check).
7. Handler: one call into `@ofl/server-core`.
8. `onResponse` (global): `services.metrics.observeHttp` with the route
   pattern (`request.routeOptions.url`) as the label.
9. `setErrorHandler` ([`api/errors.ts`](api/errors.ts)): one JSON format
   `{ error, code, correlationId }` for validation errors, 413, 429, CSRF,
   and internal errors (message hidden for 5xx).

### GraphQL and subscriptions

[`routes/graphql.ts`](api/routes/graphql.ts) creates a Yoga instance with the
schema, plugins, and per-request context from server-core and replies with
`yoga.handleNodeRequestAndResponse(request, reply)`. The `context` factory
passes `request.viewer` and enables `countQueries` only when
`ENABLE_QUERY_COUNT=true` and the request sends `x-ofl-debug-query-count: 1`.

`GET /graphql` is one route with two handlers: `@fastify/websocket` sends
upgrade requests to `wsHandler`, plain GETs to `handler` (Yoga). The upgrade
passes through the same hooks, so a route-level `preValidation` rejects a
present, non-allowlisted `Origin` with 403 before the upgrade completes. The
accepted socket is handed to graphql-ws (`useServer` on a `noServer`
`WebSocketServer`), which authenticates with the session cookie of the
upgrade request and uses `graphqlWsServerOptions` from server-core.

### Webhook

[`routes/webhook.ts`](api/routes/webhook.ts) registers a scoped
`application/json` parser with `parseAs: 'string'` that stores the exact
bytes in `request.rawBody` (needed for the HMAC) and does not parse them.
The route has a header schema but no body schema on purpose:
`handlePaymentWebhook` verifies the signature first and validates the body
only afterwards, so an unsigned or forged request always gets 401 and never
learns the body format from a 400.

### Static SPA and shutdown

[`routes/spa.ts`](api/routes/spa.ts) serves `web/dist` with `@fastify/static`
and a not-found handler that returns `index.html` for client-side routes and
JSON 404 for API paths. [`api/server.ts`](api/server.ts) calls
`fastify.close()` on SIGTERM/SIGINT: Fastify stops accepting connections,
waits for in-flight requests, then runs `onClose` hooks (graphql-ws dispose,
`closeServices`).

### Worker

[`worker/main.ts`](worker/main.ts) runs `startWorker` and a minimal Fastify
instance on :9007 with `/health/live`, `/health/ready`, `/metrics`. On
SIGTERM it stops the health server, lets in-flight jobs finish
(`worker.stop()`), then closes the services.

### Build

[`scripts/build.mjs`](scripts/build.mjs) bundles `api/server.ts` and
`worker/main.ts` with esbuild. Workspace packages (`@ofl/*`, TypeScript
sources) are bundled; packages from `node_modules` stay external and resolve
from this package's dependencies at runtime.

## Differences from the Express variant

| Concern | Express | Fastify |
| --- | --- | --- |
| Composition | Middleware stack, order of `app.use` decides | Plugin tree with encapsulation; scope decides |
| Per-request data | `res.locals` / `req` properties | Typed request decorators (`decorateRequest` + declaration merging in [`api/fastify-augment.ts`](api/fastify-augment.ts)) |
| Input validation | Hand-written checks or zod in the handler | JSON schema on the route (Ajv), 400 before the handler runs |
| Raw body for webhook | `express.raw()` on one route | Scoped content type parser |
| Logging | `pino-http` middleware | Built-in pino logger, `genReqId`, `request.log` |
| WebSocket | `ws` server on the HTTP `upgrade` event | `@fastify/websocket` route with `wsHandler`; hooks run on the upgrade |
| Tests | supertest over a socket | `fastify.inject()` without a socket |
| Shutdown | `server.close()` plus manual cleanup | `fastify.close()` runs `onClose` hooks in reverse registration order |
