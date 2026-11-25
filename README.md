# Order Fulfillment Lab

One order fulfillment and inventory platform, built three times:

| Variant | Server | UI | Folder |
| --- | --- | --- | --- |
| Express | Express 5 + GraphQL Yoga | React SPA (React Router, Redux Toolkit, urql) | [`implementations/express`](implementations/express) |
| Fastify | Fastify 5 + GraphQL Yoga | Same React SPA | [`implementations/fastify`](implementations/fastify) |
| Next.js | Next.js 16 App Router (route handlers, Server Actions) | Server Components + client components | [`implementations/nextjs`](implementations/nextjs) |

All three use the same PostgreSQL schema, the same GraphQL contract, the same
business code, and pass the same 14 acceptance scenarios. The differences are
framework mechanics only: routing, middleware or hooks, lifecycle, error
handling, WebSocket hosting, and rendering.

This is a learning and interview-preparation project. It is not deployed and
holds no production data. The `.env` files in the repository contain local
placeholder values only.

## What the product does

Three roles use one shop with two warehouses (`WH-EAST`, `WH-WEST`), one
currency (USD), and simulated payments.

| Role | Screens |
| --- | --- |
| Customer | Catalog search (full text, autocomplete, typo tolerance, facets), product detail with per-warehouse stock, cart, checkout, my orders, live order status, cancel, partial return |
| Warehouse operator | Orders awaiting shipment per warehouse, ship, receive returns, inventory list, stock adjustments, movement history |
| Administrator | Orders by status, daily and cumulative revenue, low stock, job backlog and failed jobs with retry, audit log, price changes |

## How it works

```mermaid
flowchart LR
  UI[Browser UI] -- GraphQL over HTTP --> API[Express / Fastify / Next.js]
  UI -- graphql-ws --> WS[Subscriptions]
  API --> CORE[@ofl/server-core]
  WS --> CORE
  CORE -- one transaction: business rows + outbox row + NOTIFY --> PG[(PostgreSQL)]
  W[Worker] -- claims outbox jobs, SKIP LOCKED --> PG
  W -- payment, refund, search index --> EXT[Simulated gateway / Elasticsearch]
  CORE -- search queries --> ES[(Elasticsearch)]
  PG -- LISTEN order_events --> WS
```

- **PostgreSQL is the source of truth.** Elasticsearch holds a derived copy of
  products for search only. Checkout always rechecks stock and price in PostgreSQL.
- **Checkout** locks the stock rows in a fixed order, allocates units across
  the two warehouses, creates the order and the reservations, and writes outbox
  events, all in one transaction. An idempotency key makes retries return the
  first result.
- **Side effects** (payment, refund, search indexing, reservation expiry) run in
  a separate worker process. The worker claims outbox rows with leases, retries
  with backoff, and moves permanent failures to a visible FAILED state.
- **Live order status** uses PostgreSQL `NOTIFY` as a hint across processes. The
  subscription always re-reads the order from PostgreSQL.

Main rules that the tests prove:

- No overselling under concurrent checkout.
- Each payment notification, shipment, restock, and refund takes effect once.
- Races between payment, expiry, cancellation, and shipment have one defined winner.
- Stock balances always equal the sum of the movement ledger.
- Customers cannot read or change other customers' orders.

## Repository layout

```
contracts/            GraphQL schema, client operations, 14 acceptance scenarios
packages/
  domain/             Pure business rules: money, allocation, state machines, validation
  graphql-types/      Generated TypeScript types and typed documents
  server-core/        Application layer shared by all variants (see below)
  test-fixtures/      Seed data: demo, contract, bench profiles (`ofl-seed`)
  test-contracts/     The acceptance suite every variant runs
  web-spa/            React SPA used by the Express and Fastify variants
implementations/
  express/  fastify/  nextjs/   Server, worker, UI entry, tests, README per variant
infrastructure/postgres/migrations/   SQL migrations
scripts/bench/        Load generator and benchmark scenarios
docs/                 Requirements, architecture, decisions (ADRs), design notes
reports/              Benchmark and review reports
```

`@ofl/server-core` contains checkout, payments, expiry, fulfillment, returns,
inventory, the outbox worker, search, realtime, authentication, the GraphQL
schema with resolvers and DataLoaders, metrics, and the `ofl` CLI. Framework
code calls it but never contains business rules.

## Prerequisites

| Tool | Version used |
| --- | --- |
| Node.js | 22.12 or later (tested on 26.13) |
| pnpm | 10.20 |
| PostgreSQL | 17 on `localhost:5432` (tested with a local user `shohelshamim`, trust authentication) |
| Docker | For Elasticsearch 9.2.4 (`compose.yaml`) |

To use another PostgreSQL user, change `DATABASE_URL` in each
`implementations/*/.env` and `PGUSER` for `pnpm db:create`.

## Setup (once)

Run from the repository root:

1. `pnpm install`
2. `pnpm infra:up` — starts Elasticsearch on `127.0.0.1:9200`.
3. `pnpm db:create` — creates the databases (dev and test for each variant, plus `ofl_core_test` and `ofl_bench`).
4. `pnpm codegen` — generates GraphQL types (already committed; needed after schema changes).

## Run a variant

Each variant has its own database, index prefix, and ports, so all three can
run at the same time.

| Variant | Database | App / API | Web (dev) | Realtime | Worker health |
| --- | --- | --- | --- | --- | --- |
| Express | `ofl_express` | http://localhost:4100 | http://localhost:4101 | 4100 | 4102 |
| Fastify | `ofl_fastify` | http://localhost:4200 | http://localhost:4201 | 4200 | 4202 |
| Next.js | `ofl_nextjs` | http://localhost:4300 | http://localhost:4300 | 4301 | 4302 |

Commands (replace `express` with `fastify` or `nextjs`):

| Purpose | Command |
| --- | --- |
| Load demo data (resets the database) | `pnpm seed:express` |
| Reset schema and reload demo data | `pnpm reset:express` |
| Development (API, worker, and web together) | `pnpm dev:express` |
| Production build | `pnpm build:express` |
| Run the production build | `pnpm start:express` |
| Tests (unit, HTTP, acceptance) | `pnpm test:express` |
| Type check / lint | `pnpm typecheck:express` / `pnpm lint:express` |

In development, open the "Web (dev)" URL. After `start`, open the "App / API" URL.

Demo accounts (local seed data only):

| Email | Password | Role |
| --- | --- | --- |
| `customer@example.com` | `customer-pass-1` | Customer |
| `customer2@example.com` | `customer-pass-2` | Customer |
| `operator@example.com` | `operator-pass-1` | Warehouse operator |
| `admin@example.com` | `admin-pass-1` | Administrator |

Test payment tokens at checkout: approve, decline, or slow approve (approves
after the reservation hold expires, to show the expiry race).

Operations CLI (run inside a variant folder; it reads that variant's `.env`):

| Command | Effect |
| --- | --- |
| `pnpm exec ofl migrate` | Apply pending migrations |
| `pnpm exec ofl reindex` | Rebuild the search index with an alias switch |
| `pnpm exec ofl jobs` | List failed jobs |
| `pnpm exec ofl retry-jobs --all-failed` | Move failed jobs back to pending |
| `pnpm exec ofl reconcile` | Compare stock balances with the movement ledger |

## Tests

| Suite | Command | Result (final run, 2026-11-25) |
| --- | --- | --- |
| Domain rules (unit) | `pnpm --filter @ofl/domain test` | 53 / 53 |
| Application layer (integration, real PostgreSQL + Elasticsearch) | `pnpm --filter @ofl/server-core test` | 112 / 112 |
| Seed fixtures | `pnpm --filter @ofl/test-fixtures test` | 5 / 5 |
| Acceptance suite helpers | `pnpm --filter @ofl/test-contracts test` | 6 / 6 |
| Shared SPA (React Testing Library) | `pnpm --filter @ofl/web-spa test` | 32 / 32 |
| Express (HTTP + 14 acceptance scenarios) | `pnpm test:express` | 30 / 30 |
| Fastify (HTTP + 14 acceptance scenarios) | `pnpm test:fastify` | 34 / 34 |
| Next.js (components, route handlers, rendered pages, 14 acceptance scenarios) | `pnpm test:nextjs` | 108 / 108 |

Total: 380 tests, all passing. Type checks, lint, and production builds also pass
(`pnpm typecheck`, `pnpm lint`, `pnpm build`, plus `typecheck:scripts` and `lint:scripts`).

Run everything, one package at a time: `pnpm test`.

The acceptance scenarios (full text in
[`contracts/acceptance-scenarios/scenarios.md`](contracts/acceptance-scenarios/scenarios.md)):

| # | Scenario |
| --- | --- |
| S1 | 20 concurrent customers, last 5 units: exactly 5 reservations succeed |
| S2 | Concurrent retries with one idempotency key: one order, one reservation |
| S3 | Declined payment releases stock once |
| S4 | Duplicate payment notifications have no extra effect |
| S5 | Payment confirmation races with expiry without corrupting stock |
| S6 | Multi-item checkout fails atomically when one item is short |
| S7 | Worker stops after the payment call, before acknowledgement; retry ends correctly |
| S8 | Duplicate or reordered search events leave no stale data |
| S9 | One order ships from two warehouses |
| S10 | Partial return restocks the right quantity once |
| S11 | A customer cannot read or change another customer's order |
| S12 | Database query count stays constant as the order list grows |
| S13 | Elasticsearch failure does not affect checkout |
| S14 | Live order updates across API processes, with reconnect |

## Benchmark report

Measured on an Apple M3 Max (16 cores, 64 GB), PostgreSQL 17 local,
Elasticsearch 9.2.4 in Docker with a 1 GB heap. The dataset is the bench
profile: 20,060 products, 200,039 orders, 800,303 stock movements. Load
generator and server run on the same laptop, so the numbers show relative
behavior, not production capacity.

### Two measured optimizations

| Change | Query or scenario | Before | After |
| --- | --- | --- | --- |
| [Migration 0002](infrastructure/postgres/migrations/0002_orders_customer_keyset_index.sql): index `orders (customer_id, created_at DESC, id DESC)` | "My orders" first page (database time, p50) | 1.751 ms with 5,000 orders; 5.374 ms with 26,720 orders — reads every row of the customer, then sorts | 0.007 ms; 0.009 ms — index scan stops after 21 rows |
| [Migration 0003](infrastructure/postgres/migrations/0003_shipment_lines_order_line_index.sql): index `shipment_lines (order_line_id)` | Checkout at 50 concurrent connections (HTTP, Express) | p50 414.7 ms, 108.8 req/s | p50 36.6 ms, 1,345.8 req/s |

The second problem was found by measurement. With a minimal response, checkout
was already fast. The full order response looked up shipped quantities, and
that lookup scanned all 300,000 shipment lines on every request. Plans and
details: [`reports/explain-my-orders.md`](reports/explain-my-orders.md) and
[`docs/performance.md`](docs/performance.md).

### Load scenarios

Observed results, run 1 ([`reports/benchmarks.md`](reports/benchmarks.md)). 15 s per scenario after a 3 s warm-up; bench data reloaded before each variant.

| Scenario | Variant | Connections | Throughput (req/s) | p50 ms | p95 ms | Errors | Target p50 / p95 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Product search | Express | 20 | 1903.7 | 9.7 | 17.3 | 0 % | 30 / 100 |
| Product search | Fastify | 20 | 1642.1 | 11.3 | 20.3 | 0 % | 30 / 100 |
| My orders, first page (customer with 5,000 orders) | Express | 20 | 1867.2 | 10.6 | 14.2 | 0 % | 20 / 60 |
| My orders, first page | Fastify | 20 | 887.9 | 12.4 | 77.1 (missed) | 0 % | 20 / 60 |
| Checkout, distinct SKUs | Express | 50 | 1257.9 | 38.3 | 50.1 | 0 % | 60 / 200 |
| Checkout, distinct SKUs | Fastify | 50 | 1117.5 | 41.9 | 58.9 | 0 % | 60 / 200 |
| Checkout, one hot SKU | Express | 50 | 2144.2 | 19.4 | 59.3 | 0 % | – / 500 |
| Checkout, one hot SKU | Fastify | 50 | 1746.1 | 20.5 | 92.2 | 0 % | – / 500 |

| Worker (5,000 search jobs, empty outbox) | Throughput | Lag p95 | Target |
| --- | --- | --- | --- |
| Concurrency 4 | 209 jobs/s | 22.8 s (missed) | ≥ 200 jobs/s, lag p95 ≤ 5 s |
| Concurrency 16 | 708 jobs/s | 6.6 s (missed) | same |

Correctness under load, both variants: hot SKU sold out to exactly 0 with no
oversell, `OperatorOrders` used 10 database queries for 5, 20, and 50 orders,
and the ledger reconciled with 0 differences.

Caveats: the Fastify "my orders" row is an outlier. An earlier quiet run gave
1731.7 req/s, p95 15.5 ms; a Fastify-only rerun ran while unrelated host
processes held the load average near 56 on 16 cores and is kept only as
evidence ([`reports/benchmarks-rerun-fastify-under-load.md`](reports/benchmarks-rerun-fastify-under-load.md)).
Laptop noise is larger than the Express/Fastify difference, so these numbers do
not rank the frameworks. The worker lag target was badly chosen for a burst of
5,000 jobs: draining at 209 jobs/s takes about 24 s by definition.

Rerun: load the bench data with
`BENCH_CUSTOMERS=40 DATABASE_URL=postgresql://<user>@localhost:5432/ofl_bench ES_INDEX_PREFIX=ofl_bench_ pnpm exec ofl-seed --profile bench`
(inside any variant folder), then `pnpm bench` and `pnpm bench:explain` at the root.

## Documentation

| Document | Content |
| --- | --- |
| [requirements.md](docs/requirements.md) | Roles, invariants, state machines, workflows, race rules, security, ports |
| [architecture.md](docs/architecture.md) | Components, package boundaries, the server-core API |
| [domain-model.md](docs/domain-model.md) | Entities, stock quantities, state diagrams |
| [workflows.md](docs/workflows.md) | Checkout, payment, expiry race, fulfillment, returns, search sync |
| [database-design.md](docs/database-design.md) | Constraints, transaction boundaries, locking, indexes, pagination |
| [graphql-design.md](docs/graphql-design.md) | Error model, pagination, DataLoader, limits, subscriptions |
| [performance.md](docs/performance.md) | Targets, method, results |
| [stack-comparison.md](docs/stack-comparison.md) | Express vs Fastify vs Next.js, with code links |
| [decisions/](docs/decisions/README.md) | Architecture decision records and tool versions |
| Variant READMEs | [Express](implementations/express/README.md), [Fastify](implementations/fastify/README.md), [Next.js](implementations/nextjs/README.md) |

## Known limits

- Rate limits are counted in memory per process. Several instances allow several times the limit.
- One PostgreSQL primary. Partitioning and read replicas are not used; `docs/database-design.md` explains when they would be needed.
- Delivery of background events is at least once; every consumer is idempotent. There is no exactly-once claim.
- The UIs are covered by component tests and HTTP checks; they were not tested in a real browser by an automated suite.
- `/metrics` endpoints are not authenticated; expose them only on an internal network.
- Independent review findings and their fixes: [`reports/review-findings.md`](reports/review-findings.md).
