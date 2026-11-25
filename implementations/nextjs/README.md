# Order Fulfillment Lab — Next.js variant

The same product as the Express and Fastify variants (catalog and search,
checkout, orders with live status, returns, warehouse and operations
dashboards), built with the Next.js 16 App Router. All business rules live in
[`@ofl/server-core`](../../packages/server-core) and
[`@ofl/domain`](../../packages/domain); this folder only contains the
framework layer.

| Process | Port | Entry |
| --- | --- | --- |
| Next.js app (pages, route handlers, Server Actions) | 9008 | [`app/`](app) |
| Realtime service (graphql-ws subscriptions) | 9009 | [`modules/realtime/main.ts`](modules/realtime/main.ts) |
| Worker (outbox jobs) + health/metrics | 9010 | [`worker/main.ts`](worker/main.ts) |

Database `ofl_nextjs` (tests: `ofl_nextjs_test`), Elasticsearch prefix
`ofl_nextjs_` (tests: `ofl_nextjs_test_`).

## Running it

Prerequisites: PostgreSQL on localhost (databases created with
`pnpm db:create` at the repository root) and Elasticsearch on
`127.0.0.1:9200`.

```bash
cd implementations/nextjs
cp .env.example .env
pnpm reset          # ofl reset (migrate + empty) && ofl-seed --profile demo
pnpm dev            # next dev :9008 + realtime :9009 + worker :9010 (tsx watch)
# or the production build:
pnpm build          # next build + esbuild bundles dist/realtime.mjs, dist/worker.mjs
pnpm start          # next start + node dist/realtime.mjs + node dist/worker.mjs
```

[`scripts/run-services.mjs`](scripts/run-services.mjs) starts the three
processes, forwards Ctrl+C / SIGTERM to all of them, and stops all of them
when one exits. Open <http://localhost:9008> and sign in with a demo account
(`customer@example.com` / `customer-pass-1`, `operator@example.com` /
`operator-pass-1`, `admin@example.com` / `admin-pass-1`).

Other scripts: `pnpm seed`, `pnpm typecheck`, `pnpm lint`, `pnpm test`
(builds, then runs every Jest project), `pnpm test:unit` (component and pure
unit tests only, no database).

## Code walkthrough

### Rendering split

| What | How | Files |
| --- | --- | --- |
| Catalog, search, product detail | Server Components. They call the application layer **in-process** with `executeOperation` (same schema, resolvers, authorization and DataLoaders as `/api/graphql`, no HTTP round trip). | [`app/(catalog)/page.tsx`](<app/(catalog)/page.tsx>), [`app/products/[slug]/page.tsx`](app/products/[slug]/page.tsx), [`modules/server/data/catalog.ts`](modules/server/data/catalog.ts) |
| Orders, warehouse, operations pages | Server Components, executed as the signed-in viewer. | [`modules/server/data/`](modules/server/data) |
| Cart, checkout, cancel, returns, ship, receive, adjust, retry | Client Components that send GraphQL mutations over HTTP to `/api/graphql` through **urql**. | [`modules/checkout/CheckoutPanel.tsx`](modules/checkout/CheckoutPanel.tsx), [`modules/orders/`](modules/orders), [`modules/warehouse/`](modules/warehouse), [`modules/admin/RetryJobButton.tsx`](modules/admin/RetryJobButton.tsx) |
| Login, logout, admin price change | Server Actions. The price is parsed on the server from the decimal string to integer cents without floating point ([`price-input.ts`](modules/admin/price-input.ts)). Blank, signed, hex or exponent input and more than two decimals are rejected. | [`modules/auth/actions.ts`](modules/auth/actions.ts), [`modules/admin/actions.ts`](modules/admin/actions.ts) |
| Live order status | Client subscription (urql + graphql-ws) to the realtime service. | [`modules/orders/OrderLiveView.tsx`](modules/orders/OrderLiveView.tsx) |

The `Services` instance (PostgreSQL pool, Elasticsearch client, logger,
metrics) is a lazily created, process-wide singleton in
[`modules/server/services.ts`](modules/server/services.ts). It is guarded by
`import 'server-only'`, so importing it from a Client Component fails the
build. It is stored on `globalThis` because `next dev` re-evaluates modules on
every edit, and a module variable would leak a pool per reload.

Every in-process call goes through
[`runOperation`](modules/server/data/run-operation.ts). graphql-js returns
null-prototype objects, which React refuses to pass to Client Components, so
the helper copies results into plain objects (`structuredClone`). Without it,
the order page breaks.

URL state: catalog filters (`q`, `category`, `price`, `stock`, `sort`,
`after`) live in the search params
([`modules/catalog/search-params.ts`](modules/catalog/search-params.ts)).
[`SearchFilters`](modules/catalog/SearchFilters.tsx) only pushes a new URL;
the Server Component renders the results. Any filter change drops the
`after` cursor, because a cursor is only valid for the filters that produced
it. Pagination uses keyset cursors, so links go "next" and "first page".

Boundaries:

- `error.tsx` exists at the root and for orders, warehouse and admin. Next 16
  passes `error: unknown` and `retry()`.
- `not-found.tsx` exists at the root and for products and orders, and
  `forbidden.tsx` renders the 403 page (`experimental.authInterrupts`).
- `global-error.tsx` covers failures in the root layout itself (for example,
  PostgreSQL down while reading the session).

`loading.tsx` is placed deliberately. A loading file is a Suspense boundary:
once its fallback streams, the HTTP status is already **200**. A later
`notFound()`, `forbidden()` or `redirect()` then turns into a client-side
fallback instead of a real 404/403/307. So there is no root `loading.tsx`.
Loading UI lives where it cannot hide a status code:

- The catalog uses the route group [`app/(catalog)/loading.tsx`](<app/(catalog)/loading.tsx>).
- The order list uses [`app/orders/(list)/loading.tsx`](<app/orders/(list)/loading.tsx>),
  so `/orders/[id]` still returns 404 for another customer's order.
- The admin and warehouse segments have `loading.tsx`, and their **layouts**
  run the role check. A layout renders outside its own segment's loading
  boundary, so it still returns a real 307 or 403. The pages check again,
  because layouts and pages render in parallel.
- Product detail has no loading boundary, so an unknown slug is a real 404.

An HTTP test asserts each of these status codes.

### Client state

- **urql** is the only client cache for server data (mutation results,
  autocomplete suggestions, subscription events).
- **Redux Toolkit** holds client state only
  ([`modules/store/store.ts`](modules/store/store.ts)):
  - `cart`: the lines, plus the unit price the customer saw (sent as
    `expectedUnitPriceMinor`). It is persisted to `localStorage`, and the
    data is validated when it is read back.
  - `checkout`: the current attempt's idempotency key and phase.
  - `toasts`.
- Order status, stock and prices are never copied into Redux.
- One store and one urql client exist per tab. They are created in
  `useState` inside [`Providers`](modules/store/Providers.tsx), never as module
  singletons that a server render could share between requests.

Checkout attempt and key
([`checkout-slice.ts`](modules/checkout/checkout-slice.ts)): the key is bound
to a signature of the lines, prices and payment token.

- A retry after a network failure reuses the key, so the server replays the
  first result and there is no double order.
- Any cart change produces a new key, as requirements §6.1 asks.
- `IdempotencyKeyReused` and success reset the attempt.

[`checkout-outcome.ts`](modules/checkout/checkout-outcome.ts) maps every
`CheckoutResult` member and transport failure to a UI outcome, with an
exhaustive `never` check. [`CheckoutFeedback`](modules/checkout/CheckoutFeedback.tsx)
moves focus to the result heading, and an `aria-live` region announces the
pending state.

### Caching and invalidation

This variant does not enable `cacheComponents`. It uses the previous caching
model, which Next 16 still supports:

- Route rendering is dynamic per request.
- Public data goes into the data cache through `unstable_cache`.
- Per-user data is never cached.

| Data | Cache | Freshness rule |
| --- | --- | --- |
| Search results (Elasticsearch) | `unstable_cache`, 15 s, tag `catalog:search`, key = environment (index prefix) + the search variables, executed with `viewer = null` | Search is already eventually consistent: the worker re-indexes after each commit. 15 s adds a small, bounded delay. A price change by an admin (Server Action) calls `revalidateTag('catalog:search', 'max')`. |
| Categories | `unstable_cache`, 300 s, tag `catalog:categories` | Rarely change. |
| Product detail and per-warehouse stock | **not cached** | Read from PostgreSQL on every request. Checkout rechecks stock and price under row locks anyway, so a stale badge can never oversell. |
| Orders, dashboards, viewer | **never cached** | See "Keeping user data out of shared caches" below. |

The data cache lives on disk (`.next/cache`) and survives restarts. The cache
key therefore includes the environment (the Elasticsearch index prefix), so a
server pointed at another database never serves entries written for a
different one; this happened once during testing. When `NODE_ENV=test`, the
data cache is bypassed, because tests reset the database under a running
server. The check reads `config.nodeEnv` at runtime, since Next inlines
`process.env.NODE_ENV` at build time.

After a client mutation, the component calls `router.refresh()`. That
re-renders the Server Components on the current page with fresh data and keeps
client state (the cart and form drafts). The order page also merges the
mutation result and subscription events into the view, keeping whichever
copy has the newest `updatedAt`
([`latest-order.ts`](modules/orders/latest-order.ts)). The GraphQL route
handler does not revalidate catalog tags after mutations. Stock and price
changes reach search only when the worker re-indexes, so invalidating at
mutation time would just re-cache the old Elasticsearch data.

Keeping user data out of shared caches (Next 16):

1. The root layout reads `cookies()` (to show the viewer), and so does every
   user page through `getViewer()`/`requireViewer()`. Reading cookies opts
   the route into dynamic rendering: nothing is prerendered or stored in the
   full route cache. Next then sends
   `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate`
   on these HTML responses. An HTTP test asserts this.
2. Per-user reads go through `queryAsViewer` (`executeOperation` with the
   viewer). They are never wrapped in `unstable_cache`. React `cache()` only
   dedupes within one render.
3. The cached catalog functions never read cookies or headers, and they always
   run with `viewer = null`. Their result is identical for every user.
4. Route handlers that depend on the session (`/api/graphql`,
   `/api/auth/*`) set `Cache-Control: private, no-store` (plus
   `Vary: Cookie` on GraphQL). Health and metrics set `no-store` and
   `dynamic = 'force-dynamic'`.

### Authentication and authorization

- Session: the `ofl_session` cookie is resolved with `resolveSession` in
  [`modules/server/session.ts`](modules/server/session.ts) (pages, Server
  Actions), in [`graphql-handler.ts`](modules/server/graphql-handler.ts)
  (from the raw `Cookie` header), and in the realtime service (from the
  upgrade request).
- UI login and logout are Server Actions
  ([`modules/auth/actions.ts`](modules/auth/actions.ts)) that set or delete
  the cookie with `cookies()`. CSRF protection there is Next's built-in
  Origin-vs-Host check for Server Actions (POST only). The `next` return path
  is restricted to local paths.
- The acceptance suite uses JSON route handlers instead:
  `POST /api/auth/login` and `POST /api/auth/logout`
  ([`auth-handlers.ts`](modules/server/auth-handlers.ts)). They follow the
  §10 contract: 200 `{user}`, 400, 401, 403 without `x-ofl-csrf: 1`, 429,
  and logout returns 204 with an expired cookie. Route handlers write
  `Set-Cookie` themselves, so they also work outside a Next request scope
  (tests call them directly).
- Authorization stays in the application layer. Page guards
  (`requireViewer`, `requireRole` → `redirect`/`forbidden()`) are UX only,
  and each protected page calls them itself: App Router layouts render in
  parallel with pages, so a layout check alone would not stop the page's data
  fetch. `queryAsViewer` maps application errors: `NOT_FOUND` →
  `notFound()` (another customer's order looks like a missing one),
  `FORBIDDEN` → `forbidden()`, and anonymous `UNAUTHENTICATED` → login
  redirect.
- Role-dependent controls are hidden in the UI for convenience. The server
  computes `allowedActions` and rejects any action anyway.

### Route handlers and HTTP hardening

| Route | Notes |
| --- | --- |
| `POST /api/graphql` | GraphQL Yoga with `createGraphQLContext` (fresh DataLoaders per request) and `graphqlYogaPlugins` (depth/cost limits, error masking, metrics). `x-ofl-debug-query-count: 1` sets `countQueries` when `ENABLE_QUERY_COUNT=true`. Only POST is exported, so the CSRF rule covers every operation. |
| `POST /api/auth/login`, `/logout` | See above. |
| `POST /api/webhooks/payments` | Raw body via the request stream → `handlePaymentWebhook` (HMAC over exact bytes). No CSRF header: the caller is not a browser and the signature authenticates it. |
| `GET /api/health/live`, `/ready`, `/api/metrics` | Liveness without dependencies; readiness checks PostgreSQL and Elasticsearch (503 when not ready); Prometheus text. |

Shared guards are in
[`modules/server/http/guards.ts`](modules/server/http/guards.ts):

- **CSRF header**: `x-ofl-csrf: 1` is required.
- **Same-origin only, no CORS**: `/api/*` accepts a request when `Origin`
  is absent, equals the request's own origin, or is listed in `APP_ORIGIN`.
  Any other origin gets 403.
  - `APP_ORIGIN` lists other public origins of **this** app, for example
    the hostname a reverse proxy serves it under. It does not name
    third-party CORS clients.
  - No `Access-Control-Allow-*` header is ever sent, and every `OPTIONS`
    preflight gets 403. Browsers only preflight cross-origin requests, and
    none are supported.
  - For the realtime WebSocket, the same `APP_ORIGIN` list extends the
    allowlist.
- **Body limit**: 100 KB. A declared `Content-Length` over the limit is
  rejected at once; otherwise the stream is counted while it is read. Server
  Actions use `serverActions.bodySizeLimit: '100kb'`.
- **Rate limits**
  ([`rate-limit.ts`](modules/server/http/rate-limit.ts)): fixed windows of
  login 10/min, GraphQL 300/min and webhook 120/min per client, plus login
  10/min **per account** (normalized email).
  - Who "the client" is
    ([`request-meta.ts`](modules/server/http/request-meta.ts)): route
    handlers and Server Actions get no socket, only headers. `next start`
    sets `X-Forwarded-For` to the socket address only when the client did
    not send one (`??=` in Next's base server), so the header is
    attacker-controlled.
  - With `TRUST_PROXY=true` (exactly one trusted proxy that appends the
    connecting address), the key is the **right-most** `X-Forwarded-For`
    entry.
  - Otherwise (the default), there is no trustworthy client IP, so each
    route uses **one shared bucket**. Rotating the header cannot reset a
    counter, and the per-account login limit still throttles password
    guessing.
  - Regression tests in
    [`tests/server/route-handlers.test.ts`](tests/server/route-handlers.test.ts)
    send a rotating `X-Forwarded-For` and still get 429.
  - Audit rows record an IP only when it is trusted.

[`observed()`](modules/server/http/observe.ts) adds the correlation ID,
records the HTTP metric, and turns unexpected errors into a generic 500.

Security headers come from `headers()` in
[`next.config.ts`](next.config.ts): CSP, `nosniff`, `X-Frame-Options: DENY`,
Referrer-Policy, Permissions-Policy, COOP/CORP, and HSTS in production. The
`X-Powered-By` header is disabled.

### Realtime service

Next.js route handlers cannot accept WebSocket upgrades. Subscriptions
therefore run in a small Node process,
[`modules/realtime/server.ts`](modules/realtime/server.ts):

- It uses `ws` with graphql-ws `useServer` and `graphqlWsServerOptions` from
  server-core, and the same schema as the app.
- The session comes from the `ofl_session` cookie on the upgrade request.
  Cookies are scoped by host, not by port, so a page on
  `localhost:9008` sends its cookie to `localhost:9009`. The page derives the
  WebSocket URL from the host it was loaded from
  ([`realtime-url.ts`](modules/server/realtime-url.ts)), so `localhost`
  versus `127.0.0.1` always matches.
- Origin check: a present `Origin` must be on the allowlist
  (`http://localhost:PORT`, `http://127.0.0.1:PORT` and `APP_ORIGIN`). This
  blocks cross-site WebSocket hijacking. Upgrades without `Origin`
  (non-browser clients) are accepted and still need a valid session for any
  subscription. Messages are limited to 100 KB.
- Cross-process fan-out: each realtime process has its own `Services`, which
  `LISTEN`s on `order_events`. A change committed by any app or worker
  process reaches every subscriber.
- Reconnect and missed events: the client
  ([`modules/graphql/client.ts`](modules/graphql/client.ts)) connects lazily
  and retries forever with capped exponential backoff and jitter. graphql-ws
  re-subscribes after reconnecting, and the server emits the **current
  order** first on every subscribe. Events missed while offline are not
  replayed; the current state replaces them. The page shows the connection
  state in a polite live region.
- Graceful shutdown (SIGTERM/SIGINT): clients are closed with 1001 and
  reconnect elsewhere. Then the server and the pool are closed.

### Worker

[`worker/main.ts`](worker/main.ts):

- `startWorker`, plus `/health/live`, `/health/ready` and `/metrics` on port
  9010.
- The health server and the realtime service bind to `HOST`, which defaults
  to `127.0.0.1`. Set `HOST=0.0.0.0` only behind a proxy or inside a
  container network.
- On SIGTERM it stops claiming jobs and waits for in-flight jobs (`stop()`),
  then closes the health server and the services. A 15-second watchdog
  forces exit
  ([`modules/process/shutdown.ts`](modules/process/shutdown.ts)).

### Build

- Workspace packages are TypeScript source and use `transpilePackages`.
- Next bundles route handlers and Server Components separately, and each
  bundle gets its own copy of transpiled workspace modules. The `Services`
  singleton, however, is shared through `globalThis`, so an error thrown by
  Services code in one bundle can be classified by code from the other.
  `@ofl/domain` therefore brands `AppError` with
  `Symbol.for('ofl.AppError')`, and server-core uses `isAppError()` instead
  of `instanceof`. graphql stays bundled: it is ESM-only, and loading it as an
  external failed with `ERR_REQUIRE_ESM_RACE_CONDITION`. Each bundle builds
  its own schema, because the schema cache is per module copy.
- `next build` type-checks with [`tsconfig.build.json`](tsconfig.build.json)
  (app code only). `pnpm typecheck` also covers the tests.
- Native and Node-heavy libraries are listed in `serverExternalPackages`
  (`pg`, `@node-rs/argon2`, `@elastic/elasticsearch`, `pino`,
  `prom-client`, `ws`). They are direct dependencies of this package, so
  Turbopack can resolve them from the project directory.
- [`scripts/bundle-services.mjs`](scripts/bundle-services.mjs) bundles the
  realtime service and the worker with esbuild. It inlines `@ofl/*` and keeps
  the same libraries external.

## Testing

| Jest project | Environment | What |
| --- | --- | --- |
| `components` | jsdom + React Testing Library | Search filters (URL updates, facet counts, reset of the cursor), cart (add, merge, quantity, remove, validation), checkout feedback for every `CheckoutResult` member, network failure with the same key on retry, server validation errors, and role-dependent order controls including the subscription update. `next/navigation` and `next/link` are replaced by test doubles; urql gets a synchronous fake client. |
| `server` | node | Pure units (URL state, guards, rate limiter, cookies, origin allowlist, checkout key). Route handlers called directly with `Request` objects against `ofl_nextjs_test`. HTTP page tests against `next start`. The shared acceptance suite. |

**Why HTML over HTTP for pages:** Jest and React Testing Library cannot
render async Server Components. They need the React Server Components
renderer, the request scope for `cookies()`/`headers()`, and Next's routing.
Calling `await Page()` by hand would skip layouts, boundaries,
`redirect`/`notFound`/`forbidden` and response headers, which are exactly the
parts worth testing. [`tests/http/pages.test.ts`](tests/http/pages.test.ts)
instead starts the real production server
([`tests/support/next-process.ts`](tests/support/next-process.ts)) on a free
port with the test database, then fetches HTML and asserts on content,
status codes, redirects and caching headers. This is why `pnpm test` runs
`next build` first.

DB-backed tests reset `ofl_nextjs_test` to the `contract` fixture, and the
page tests also rebuild the test search index
([`tests/support/reset-data.ts`](tests/support/reset-data.ts)). Jest runs
with `--runInBand` because the files share the test database.

The acceptance suite ([`tests/acceptance`](tests/acceptance)) runs against
two app/realtime pairs (for S14) and an instance with an unreachable
Elasticsearch (for S13). No worker runs; the suite drives jobs itself. Rate
limits are disabled only when `NODE_ENV=test` and
`RATE_LIMIT_DISABLED=true`.

Last full run (`pnpm test`): 11 suites, 108 tests, all passing.

| File | Tests |
| --- | --- |
| acceptance (S1–S14) | 14 |
| http/pages | 10 |
| server/route-handlers (incl. X-Forwarded-For and per-account rate-limit regressions) | 16 |
| server/price-input (strict decimal parsing) | 23 |
| server/http-guards | 14 |
| server/search-params | 4 |
| server/checkout-attempt | 2 |
| component: checkout | 8 |
| component: cart | 6 |
| component: role controls | 6 |
| component: search filters | 5 |

## Limitations

- **Rate limits are per process.** Each Next.js instance (and each `next
  start` worker) counts on its own, so N instances allow N times the limit. A
  hard global limit needs a shared store (PostgreSQL or Redis).
- **Without `TRUST_PROXY=true`, limits are shared by all clients.** One busy
  or hostile client can exhaust a route's budget for everyone; that is the
  safe failure mode, because per-client keys would be spoofable. Production
  deployments should run behind one proxy that appends the client address,
  and set `TRUST_PROXY=true`.
- **CSP keeps `'unsafe-inline'` for scripts.** A nonce-based CSP would need
  `proxy.ts` to set a fresh nonce per request. The trade-off is documented in
  `next.config.ts`; every other directive is locked down.
- **Two hosts for live updates.** The realtime service runs on its own port.
  Behind a proxy, route `/graphql` WebSocket upgrades to it and set
  `REALTIME_PUBLIC_URL` and `APP_ORIGIN`.
- **WebSocket sessions are rechecked, not pushed.** The shared
  `graphqlWsServerOptions` re-resolves the session on every subscribe and
  checks it before each emitted event, so a subscription ends after logout at
  the next order event. Only subscriptions are served over WebSocket; queries
  and mutations must use HTTP (and its rate limit). The realtime upgrade itself
  has no rate limit.
- **Search staleness.** Search shows the Elasticsearch snapshot (plus up to
  15 s of data cache). The product page and checkout always use PostgreSQL.
- **Metrics are unauthenticated.** Expose `/api/metrics` and port 9010 only
  on an internal network.
