# PRD: Order Fulfillment Lab

| | |
| --- | --- |
| Status | Implemented (final test run 2026-11-26: 413 / 413 passing) |
| Type | Learning and interview-preparation project; not deployed, no production data |
| Normative spec | [`docs/requirements.md`](../docs/requirements.md) (this PRD summarizes it; on conflict the spec wins) |

## 1. Problem

Comparisons between Node.js frameworks usually compare toy "hello world"
apps. They do not show how Express, Fastify, Next.js and NestJS differ when the
application has real problems: concurrent stock reservations, payments that
arrive twice or late, background jobs that crash halfway, live updates
across processes, and security rules at the HTTP edge.

This project builds one realistic product four times, with the business code
shared, so that every difference that remains is a framework difference.

## 2. Goals

1. One order fulfillment and inventory product with real concurrency and failure handling.
2. Four implementations (Express 5, Fastify 5, Next.js 16, NestJS 12) with identical behavior, proven by one shared acceptance suite.
3. Business rules live once (`@ofl/domain`, `@ofl/server-core`); framework code contains none.
4. Measured performance evidence, with honest caveats.
5. Documentation a reader can use to understand and explain the system: written docs, diagrams, and interactive walkthroughs.

### Non-goals

- Production deployment, real payments, multi-currency, tax, shipping carriers.
- Horizontal scaling beyond one PostgreSQL primary (no partitioning or read replicas).
- Exactly-once delivery (the design is at-least-once with idempotent consumers).
- Ranking the frameworks by speed (laptop noise is larger than the difference).

## 3. Users

| Role | Needs |
| --- | --- |
| Customer | Find products quickly (typos, facets), buy without being oversold, see payment status live, cancel, return part of an order |
| Warehouse operator | See orders to ship per warehouse, ship, receive returns, correct stock, see the movement history |
| Administrator | See order and revenue figures, low stock, the job backlog, failed jobs and retry them, the audit log; change prices |
| Developer / interviewee (reader of this repo) | Understand how each framework structures the same concerns, run everything locally, trace any request end to end |

## 4. Scope and requirements

### 4.1 Functional

| ID | Requirement | Proved by |
| --- | --- | --- |
| F1 | Catalog search: full text, autocomplete, typo tolerance, facets (category, price, availability) | `search.test.ts`, SPA tests |
| F2 | Product detail with per-warehouse stock from PostgreSQL | rendered-page and component tests |
| F3 | Checkout with idempotency key; allocation across WH-EAST (priority 1) and WH-WEST; `PriceChanged` / `InsufficientStock` / `IdempotencyKeyReused` results | S1, S2, S6, `checkout.test.ts` |
| F4 | Simulated payments (`tok_approve`, `tok_decline`, `tok_slow_approve`) and a signed payment webhook | S3, S4, S5, HTTP webhook tests |
| F5 | 15-minute reservation hold; expiry releases stock; sweeper as safety net | S5, `payments.test.ts` |
| F6 | Cancel before shipment, with refund when captured | `fulfillment-returns.test.ts` |
| F7 | Ship per warehouse; partial shipment state | S9 |
| F8 | Partial returns; restock into the shipping warehouse; refund | S10 |
| F9 | Inventory adjustments with a movement ledger | `operations.test.ts`, ledger check after every scenario |
| F10 | Live order status over GraphQL subscriptions, across processes, with reconnect | S14, `realtime.test.ts` |
| F11 | Admin: dashboard, failed jobs with retry, audit log, price changes | `operations.test.ts`, SPA / Next.js component tests |
| F12 | Operations CLI: migrate, reset, seed, reindex, jobs, retry-jobs, reconcile | integration tests |

### 4.2 Correctness invariants

| ID | Invariant |
| --- | --- |
| I1 | No overselling under concurrent checkout: `0 ≤ reserved ≤ on_hand` (CHECK constraints + row locks in a fixed order) |
| I2 | `on_hand` and `reserved` always equal the sum of the movement ledger |
| I3 | Each payment notification, shipment, restock and refund takes effect once |
| I4 | Races (payment vs expiry, payment vs cancel, cancel vs ship) have one defined winner: whoever locks the order row first |
| I5 | Search is derived data: a reordered or duplicate event never overwrites newer data (external versions) |
| I6 | A customer cannot read or change another customer's order, and gets NOT_FOUND rather than FORBIDDEN |

### 4.3 Security

Argon2id password hashes; random session token stored only as a SHA-256 hash;
`HttpOnly`, `SameSite=Lax`, `Secure` (production) cookie; CSRF header
`x-ofl-csrf: 1` on state-changing requests; CORS limited to the variant's web
origin; WebSocket origin check; rate limits (login 10/min, GraphQL 300/min,
webhook 120/min); 100 KB body limit; HMAC-SHA256 webhook signature over the raw
body; GraphQL depth 10 and cost 5000 limits; parameterized SQL; no secrets or
emails in logs.

### 4.4 Performance targets

| Scenario | Target p50 / p95 | Observed (Express, run 1) |
| --- | --- | --- |
| Product search, 20 connections | 30 / 100 ms | 9.7 / 17.3 ms |
| My orders first page, 20 connections | 20 / 60 ms | 10.6 / 14.2 ms |
| Checkout, distinct SKUs, 50 connections | 60 / 200 ms | 38.3 / 50.1 ms |
| Checkout, one hot SKU, 50 connections | – / 500 ms | 19.4 / 59.3 ms, sold out to exactly 0 |

Full numbers and caveats: root [`README.md`](../README.md#benchmark-report), [`docs/performance.md`](../docs/performance.md).

### 4.5 Operability

Each variant has its own database, index prefix, ports and worker, so all four
run side by side. Health (`/health/live`, `/health/ready`), Prometheus metrics,
correlation ids in logs, audit rows and outbox events. Graceful shutdown in
every process. One-command workflows in the `Makefile`.

## 5. Architecture summary

```
Browser ──GraphQL/HTTP + cookie──▶ Express | Fastify | Next.js | NestJS ──▶ @ofl/server-core ──▶ PostgreSQL
        ◀──────graphql-ws─────────  (realtime hub, LISTEN)       │   one transaction:    ▲   │
                                                                   │   rows + outbox +     │   │ outbox jobs
Payment provider ──signed webhook──▶ same handler ◀───────────────┘   pg_notify           │   ▼
                                                                         Worker ──▶ gateway / Elasticsearch
```

Decisions and their reasons are recorded as ADRs in
[`docs/decisions/`](../docs/decisions/README.md): row locks for reservations,
outbox as job queue, search versioning, shared SPA, shared application layer,
sessions and CSRF, realtime through NOTIFY, GraphQL cost and WebSocket scope,
and the NestJS integration choices (ADR 0010).

## 6. Documentation deliverable (this folder)

Request: "create an architecture directory with draw.io diagrams that explain
what the project is about and what each component does, instructions for how
to test, a PRD, and an interactive way to go through each project — click
buttons, see requests animated from the user to the webhook — because I did
not write the code and need to understand it."

| ID | Requirement | Delivered |
| --- | --- | --- |
| D1 | draw.io diagrams of the system and each project | `diagrams/01–11` (`.drawio` + `.drawio.svg`) |
| D2 | Component responsibilities and code locations | `README.md` §4, "Component" tab on every interactive box |
| D3 | How to test, also as Makefile targets | `README.md` §5; new targets `test-domain`, `test-core`, `test-spa`, `test-scenario`, `architecture`, `diagrams` |
| D4 | Interactive per-project walkthroughs with animated requests | `interactive/` — Express, Fastify, Next.js (11 scenarios each), NestJS (13), shared core (7 scenarios), overview hub |
| D5 | Cover the user's view through to webhooks and background work | Every scenario starts at the user or the payment provider and shows the browser screen, the framework hops, SQL, outbox jobs, worker, gateway, NOTIFY and the live update |
| D6 | Link explanations to evidence | Each scenario lists the tests that prove it; the hub maps S1–S14 to walkthroughs |
| D7 | No build step, works offline | Plain HTML/CSS/JS; open the file or `make architecture` |

### Success criteria

- A reader who has not seen the code can explain checkout, the outbox, the
  expiry race and the webhook after stepping through the walkthroughs.
- Every command in the docs runs as written (`make test-domain`,
  `make test-scenario VARIANT=fastify S=S9` and `VARIANT=express S=S1` were run while
  writing this).
- Every page runs all of its scenario steps without script errors (checked with
  a headless browser run over every step of every scenario).

### Change log

- 2026-11-26: fourth variant, NestJS 12 (`implementations/nestjs`, ports 9011–9013, 33 tests),
  added on request ("build the NestJS version"); interactive page `nestjs.html`, diagram 11, ADR 0010.

## 7. Known limits and open questions

- Rate limits are counted in memory per process.
- `/metrics` is unauthenticated; expose it only internally.
- UIs are covered by component and HTTP tests, not by an automated real-browser suite.
- Worker lag target (p95 ≤ 5 s for a burst of 5,000 jobs) was badly chosen; draining at ~209 jobs/s takes ~24 s by definition.
- The interactive walkthroughs are hand-written descriptions of the code, not
  generated from it. If behavior changes, update `interactive/assets/scenarios.js`
  together with the code.
