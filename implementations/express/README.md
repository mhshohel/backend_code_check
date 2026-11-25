# Express variant

Express 5 HTTP server, GraphQL Yoga, graphql-ws on the same port, a worker
process, and the shared React SPA (`@ofl/web-spa`). Business rules live in
`@ofl/server-core`; this folder only wires HTTP mechanisms to it.

| Process | Port | Entry |
| --- | --- | --- |
| API (HTTP + WebSocket `/graphql`) | 4100 | `api/server.ts` |
| Vite dev server (SPA, proxies the API) | 4101 | `web/vite.config.ts` |
| Worker health/metrics | 4102 | `worker/main.ts` |

Database `ofl_express` (tests: `ofl_express_test`), Elasticsearch prefix
`ofl_express_` (tests: `ofl_express_test_`).

## Run it

```bash
cp .env.example .env        # once; DATABASE_URL points at ofl_express
pnpm reset                  # migrate + reset schema, then seed the demo profile
pnpm dev                    # API (tsx watch) + worker + Vite → http://localhost:4101
```

Demo accounts: `customer@example.com` / `customer-pass-1`,
`operator@example.com` / `operator-pass-1`, `admin@example.com` / `admin-pass-1`.

| Script | What it does |
| --- | --- |
| `pnpm dev` | `scripts/run-all.mjs dev`: API and worker with `tsx watch`, Vite on 4101. Ctrl+C stops all three. |
| `pnpm build` | `vite build` → `web/dist`; esbuild bundles `api/server.ts` and `worker/main.ts` → `dist/` (`@ofl/*` sources bundled, `node_modules` external). |
| `pnpm start` | Built API (serves `web/dist` too) and worker with `NODE_ENV=production`. Set a real `PAYMENT_WEBHOOK_SECRET`; production refuses the default. |
| `pnpm seed` / `pnpm reset` | `ofl-seed --profile demo`; `ofl reset && ofl-seed --profile demo`, using this folder's `.env`. |
| `pnpm test` | API tests over real HTTP plus the shared acceptance suite, against `ofl_express_test`. |
| `pnpm typecheck` / `pnpm lint` | `tsc` (strict) and the root ESLint config. |

## Request pipeline (`api/app.ts`)

Middleware order is deliberate:

1. **Correlation ID** (`middleware/correlation.ts`): validates or creates
   `x-correlation-id`, echoes it, stores it in `res.locals`.
2. **HTTP metrics and access log**: one histogram observation and one pino
   log line (with the correlation ID) per response; the route label comes from
   a fixed list (bounded cardinality). Health probes log at debug level.
3. **Helmet** (CSP enforced for the built SPA in production) and **CORS
   allowlist** (`WEB_ORIGINS`, default `http://localhost:4101` and
   `http://localhost:4100`, credentials allowed).
4. **Health and metrics**: `GET /health/live`, `/health/ready` (503 when
   PostgreSQL is down; Elasticsearch is reported but search is optional, the
   catalog degrades to `SEARCH_UNAVAILABLE`), `/metrics` (Prometheus). Not rate
   limited and no session lookup, so probes stay cheap.
5. **Webhook** `POST /webhooks/payments`: own rate limit (120/min),
   `express.raw` so the HMAC is checked over the exact bytes, no cookie, no
   CSRF header; `handlePaymentWebhook` decides 200/400/401.
6. **cookie-parser + session** for `/auth` and `/graphql` only:
   `resolveSession` once per request → `res.locals.viewer`.
7. **`/auth`**: CSRF header check, `express.json({ limit: '100kb' })`,
   `POST /auth/login` (10/min per IP) sets `ofl_session` with
   `sessionCookieOptions` (HttpOnly, SameSite=Lax, Path=/, Secure in
   production); `POST /auth/logout` revokes the session and clears the cookie (204).
8. **`/graphql`**: rate limit (300/min, `RATE_LIMITED` GraphQL error), CSRF
   header check, JSON body limit, then GraphQL Yoga with
   `createGraphQLContext(services, viewer, meta, { countQueries })` and
   `graphqlYogaPlugins`. Yoga's own CORS is off (the Express allowlist
   decides; `cors` passes a rejected preflight on with `next()`, and Yoga
   would otherwise echo any Origin) and its logger only reports warnings. `countQueries` is true when the request has
   `x-ofl-debug-query-count: 1` (server-core only reports it when
   `ENABLE_QUERY_COUNT=true`).
9. **Static SPA** (production): `web/dist`, hashed assets cached for a year,
   `index.html` fallback for client routes.
10. **404** and the **error handler**: client errors keep their status
    (413 body too large, 400 bad JSON), server-core `AppError`s map by code
    (`BAD_USER_INPUT` 400, `UNAUTHENTICATED` 401, `FORBIDDEN` 403,
    `NOT_FOUND` 404), anything else is logged and returned as a 500 without
    details. Body: `{ "error", "correlationId" }`.

Express 5 forwards rejected promises from async handlers to the error
handler, so routes need no try/catch.

## WebSocket (`api/websocket.ts`)

A `ws` server in `noServer` mode shares the HTTP server. The `upgrade`
handler accepts only path `/graphql`, rejects a present `Origin` outside the
allowlist with 403 (a missing Origin is accepted for non-browser clients),
then hands the socket to graphql-ws `useServer` with
`graphqlWsServerOptions`. The session cookie is resolved per connection;
server-core authorizes each subscription (another customer's order is
`NOT_FOUND`).

## Shutdown

On SIGTERM/SIGINT the API stops accepting connections, closes WebSockets
(1001, clients reconnect and receive the current order state), closes idle
keep-alive connections, waits for in-flight requests (forced after 10 s), and
then calls `closeServices`. The worker calls `stop()` (finishes in-flight
jobs), closes its probe server, then `closeServices`. A second signal or a
15 s timeout exits immediately.

## Security notes

- The UI hides controls by role and by `order.allowedActions`, but that is a
  convenience. Every permission is enforced on the server in
  `@ofl/server-core`; a customer who requests another customer's order gets
  `NOT_FOUND`.
- CSRF: `SameSite=Lax` cookie plus the required `x-ofl-csrf: 1` header on
  every state-changing browser request (ADR 0006).
- Rate limits are in memory per process. Several API instances would need a
  shared store (for example Redis) to enforce one global limit.
- `/metrics` is unauthenticated; in a real deployment it would be reachable
  only from the internal network.

## Tests (`tests/`)

- `api.test.ts`: real HTTP (`listen(0)`) for cookie flags, login/logout,
  CSRF rejection, CORS, login and GraphQL rate limits, 100 KB body limit,
  JSON and 404 error format, webhook signature, health/readiness/metrics,
  correlation IDs, and the WebSocket Origin check.
- `acceptance.test.ts`: the 14 shared scenarios from `@ofl/test-contracts`
  against this app (`ofl_express_test`, `ENABLE_QUERY_COUNT=true`, test-only
  high rate limits; `createApp`/`startHttpServer` accept `rateLimits`, the
  production defaults are unchanged).

`createApp(services, options?)` (in `api/app.ts`) returns the Express app
without listening; `startHttpServer` (in `api/http-server.ts`) adds the HTTP
server, WebSocket server and graceful stop.
