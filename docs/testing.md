# Testing

Jest is the test runner for every package. It runs in native ESM mode
(`NODE_OPTIONS=--experimental-vm-modules`) with the SWC transformer; the shared
preset is [`jest.preset.cjs`](../jest.preset.cjs). Type checking is a separate
step (`tsc`), so tests compile fast.

## 1. Test layers

| Layer | What it proves | Where | Real dependencies |
| --- | --- | --- | --- |
| Unit | Pure business rules: allocation, money, state transitions, expiry, eligibility, retry classification, validation, cursors | [`packages/domain/tests`](../packages/domain/tests) | none |
| Integration | Transactions, constraints, locking, idempotency, outbox, worker recovery, search sync, realtime, GraphQL batching and limits | [`packages/server-core/tests/integration`](../packages/server-core/tests/integration) | PostgreSQL, Elasticsearch |
| Acceptance (contract) | The 14 required scenarios over HTTP and WebSocket, against each variant | [`packages/test-contracts/src/scenarios`](../packages/test-contracts/src/scenarios) | PostgreSQL, Elasticsearch, the running variant |
| HTTP | Transport rules per framework: cookie flags, CSRF, CORS, rate limits, body limits, webhook signature, health, error format | `implementations/*/tests` | PostgreSQL, the running variant |
| Component | UI behavior: search filters, cart, checkout feedback, failures, role-dependent controls, live status | [`packages/web-spa/tests`](../packages/web-spa/tests), [`implementations/nextjs/tests/components`](../implementations/nextjs/tests/components) | jsdom, a urql client double |
| Rendered pages (Next.js) | Async Server Components: status codes, redirects, cache headers, content | [`implementations/nextjs/tests/http`](../implementations/nextjs/tests/http) | `next start` on a test port |

Database concurrency is never mocked. Concurrency tests open real
connections and run real transactions at the same time.

## 2. Isolated test resources

| Suite | Database | Elasticsearch prefix |
| --- | --- | --- |
| server-core, test-fixtures | `ofl_core_test` | `ofl_coretest_` |
| Express | `ofl_express_test` | `ofl_express_test_` |
| Fastify | `ofl_fastify_test` | `ofl_fastify_test_` |
| Next.js | `ofl_nextjs_test` | `ofl_nextjs_test_` |

Suites within one package run serially (`--runInBand`) because they share a
database. Different packages can run at the same time, except server-core and
test-fixtures, which share `ofl_core_test`. Root `pnpm test` runs one package
at a time.

## 3. How the acceptance suite runs against three frameworks

Each variant has one test file that starts its own server and hands a target
description to the shared suite:

```ts
let target: AcceptanceTarget;
beforeAll(async () => { /* start the variant on port 0 against its test DB */ target = { ... }; });
defineAcceptanceSuite(() => target);
```

Files: [Express](../implementations/express/tests/acceptance.test.ts),
[Fastify](../implementations/fastify/tests/acceptance.test.ts),
[Next.js](../implementations/nextjs/tests/acceptance/acceptance.test.ts).

The suite resets the database to the `contract` fixture, signs in through the
variant's login endpoint, sends GraphQL over HTTP with the session cookie and
the CSRF header, and verifies results with direct SQL. After every scenario it
checks that the stock balances still equal the movement ledger.

Rules the target must follow (documented in
[`scenarios.md`](../contracts/acceptance-scenarios/scenarios.md)):

- `ENABLE_QUERY_COUNT=true`, so S12 can read `extensions.queryCount`.
- Rate limits raised by a test-only option. Production defaults are unchanged.
- No worker beside the server. The suite runs `runWorkerUntilIdle({ jobIds })`
  so that each scenario processes only its own jobs, in the order it chooses.

## 4. Time and asynchronous behavior

- No fixed sleeps. Asynchronous checks use `waitFor(predicate, { timeoutMs, intervalMs })`
  with a 10 s bound.
- Expiry tests move `expires_at` into the past in SQL, or use the manual clock
  (`createManualClock`) passed to `createServices`.
- Worker crash recovery (S7) uses a fault hook that throws after the external
  call and before the job is marked done. The test then expires the lease in
  SQL and runs the worker again.

## 5. What the tests found during development

Real defects caught by these tests or by review checks, then fixed:

| Defect | Caught by |
| --- | --- |
| Express GraphQL requests hung (`handleNodeRequestAndResponse` does not write the response) | Express HTTP tests |
| Yoga's built-in CORS echoed any origin in Express | Express CORS test |
| A late subscription event could overwrite newer order state in the SPA | SPA live-order test |
| `instanceof AppError` failed across Next.js bundles; errors were masked as INTERNAL_SERVER_ERROR | Next.js search-down page check |
| Next.js loading boundaries forced status 200 on error, redirect, and 403 pages | Next.js rendered-page tests |
| Full table scan of `shipment_lines` on every order detail | Checkout benchmark (see [performance.md](performance.md)) |

Review findings and their fixes are listed in
[`reports/review-findings.md`](../reports/review-findings.md).

## 6. Next.js Server Components and Jest

Jest with React Testing Library cannot render async Server Components: they
need the Next.js server runtime (request APIs, server-only modules, streaming).
The Next.js variant therefore tests:

- client components with Jest + React Testing Library in jsdom;
- route handlers by calling the exported handler functions with `Request` objects;
- Server Component pages through HTTP against `next start` on a test port
  (status code, redirect target, `Cache-Control`, rendered text).

## 7. Commands

| Scope | Command |
| --- | --- |
| Everything, one package at a time | `pnpm test` |
| One variant | `pnpm test:express`, `pnpm test:fastify`, `pnpm test:nextjs` |
| Shared packages | `pnpm --filter @ofl/domain test`, `pnpm --filter @ofl/server-core test` |
| One acceptance scenario | `cd implementations/fastify && pnpm test -- -t "S9"` |
| Type check / lint everything | `pnpm typecheck && pnpm typecheck:scripts`, `pnpm lint && pnpm lint:scripts` |

Results of the final run are in the root [README](../README.md#tests).
