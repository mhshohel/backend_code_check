# Review pass 1: shared packages and the Fastify variant

Reviewer: review agent. Date: 2026-11-25.
Scope: `packages/domain`, `packages/graphql-types`, `contracts/`, `infrastructure/postgres/migrations`, `packages/server-core` (source only; its test suite was not run), `packages/test-fixtures`, `packages/test-contracts`, `implementations/fastify`.

How I verified things:
- I ran the required package checks and the Fastify suite.
- I created my own database `ofl_review` (ES prefix `ofl_review_`), migrated it with `ofl migrate` and seeded it with `ofl-seed --profile contract`.
- I ran adversarial scripts against it:
  - `reports/review-scratch/adversarial.ts`: application layer, in-process.
  - `reports/review-scratch/http-probe.mjs` and `http-probe2.mjs`: HTTP and WebSocket probes against the built Fastify server on 127.0.0.1:4290.
  - `reports/review-scratch/nonuuid.ts`.
- I stopped every server I started.

Overall: the core money, stock and race logic held up under every concurrency attack I tried. The ledger reconciled with zero differences after all of them. The findings are about the edges: the GraphQL cost model, worker retry bounds, WebSocket session lifetime, error classification, and tooling.

---

## Findings, most severe first

### F1. HIGH: the GraphQL cost limit does not stop root-field alias fan-out. One request causes hundreds of Elasticsearch queries.
- **Where:**
  - `packages/server-core/src/graphql/limits.ts:141-161` (`fieldCost`, `multiplier`).
  - The code does not follow its own spec in `docs/graphql-design.md:83`. The spec says each field costs 1 and an unbounded list multiplies by 50. The code makes scalar fields cost 0 and uses `UNBOUNDED_LIST_SIZE = 5`.
- **What is wrong:**
  - A composite field whose children are all scalars costs exactly 1.
  - So `a0:searchProducts(first:1){totalCount} a1:... aN:...` costs N. About 2,400 aliases fit under `MAX_COST = 5000` and the 100 KB body limit.
  - Each alias runs its own Elasticsearch search. `searchProducts` needs no sign-in (`resolvers/catalog.ts:17`).
  - The same applies to `product(slug:)`, which runs one SQL query per alias (`findProductBySlug`, no loader).
- **Failure scenario:**
  - An anonymous client sends 300 aliased `searchProducts` in one POST.
  - Elasticsearch requests time out and the request returns `SEARCH_UNAVAILABLE`.
  - The server logs hundreds of warnings ("search unavailable", TimeoutError).
  - At the 300/min HTTP rate limit, that is tens of thousands of ES queries per minute from one IP. Over WebSocket there is no rate limit (see F3).
- **Verified:**
  - `estimateCost` in `adversarial.ts` reported `cost=2500` for 2,500 aliased `searchProducts` and `cost=3000` for 3,000 aliased `product(slug)`. Neither query was rejected.
  - Against the running Fastify server (`http-probe2.mjs`):
    - one `searchProducts`: 54 ms, OK;
    - 100 aliases: 61 ms, `dataKeys=100`, so 100 ES searches ran;
    - 300 aliases: 1530 ms, `errors=1 SEARCH_UNAVAILABLE`;
    - 1,000 aliases (`http-probe.mjs`): 200 with `SEARCH_UNAVAILABLE` after 1559 ms;
    - `server.log`: 92 "search unavailable" warnings plus a burst of `TimeoutError` lines from one request.
- **Fix:**
  - Charge a base cost for every resolved field, or a fixed high cost for root fields that do I/O. For example, `searchProducts` and `productSuggestions` cost 50 and `product` costs 5.
  - Cap the number of root fields or aliases per operation, for example 20.
  - Make the code and `docs/graphql-design.md` agree.
  - Add a test that sends aliased `searchProducts` and expects `QUERY_TOO_COMPLEX`.

### F2. MEDIUM: a job that crashes the worker is reclaimed forever. `max_attempts` is never enforced on lease expiry.
- **Where:** `packages/server-core/src/outbox/outbox.ts:92` (`claimJobs` WHERE clause) together with `worker/worker.ts:61` (`SimulatedCrash` is rethrown without `failJob`).
- **What is wrong:**
  - `failJob` is the only place that moves a job to FAILED.
  - A process crash (OOM, kill, or a poison payload that crashes the process) never reaches `failJob`.
  - `claimJobs` reclaims `PROCESSING` rows with an expired lease regardless of `attempts >= max_attempts`, and increments `attempts` each time.
  - Requirements §7 asks for "max 8 attempts" and FAILED visibility.
- **Failure scenario:** a payload that makes the worker process crash is retried every 30 s forever. It never shows in `jobs(status: FAILED)` or the `failedJobs` metric, and it keeps crashing workers.
- **Verified:** `adversarial.ts` T1 ran the S7 crash hook 11 times and expired the lease each time. Result: `FAIL T1 bounded attempts under repeated crash: status=PROCESSING attempts=11 max_attempts=8`.
- **Fix:**
  - In the claim, mark expired-lease rows with `attempts >= max_attempts` as FAILED (`last_error = 'lease expired after max attempts'`) instead of reclaiming them.
  - Or add `AND attempts < max_attempts` to the reclaim branch and let a sweeper move such rows to FAILED.
  - Add a test.

### F3. MEDIUM: a WebSocket connection keeps its identity after logout or session expiry, and it bypasses the GraphQL rate limit.
- **Where:**
  - `packages/server-core/src/graphql/ws.ts:38-41`: the viewer is resolved once in `onConnect` and reused for every later operation.
  - `implementations/fastify/api/routes/graphql.ts:54-70`: the rate limit applies only to the upgrade request.
- **What is wrong:**
  - Requirements §10 asks for "server-side expiry and logout revocation".
  - After `POST /auth/logout`, HTTP requests are anonymous, but the open socket still runs queries and mutations as the logged-out user, for as long as the socket lives.
  - graphql-ws also runs queries and mutations, not only subscriptions, with no per-operation rate limit.
  - CSRF exposure is limited because the Origin check is enforced (I verified this).
- **Failure scenario:**
  - A user logs out on a shared machine while a tab still holds the socket. Anyone with that tab can still read orders and call `cancelOrder` and `requestReturn`.
  - A client can also bypass the 300/min GraphQL limit by sending operations over one socket.
- **Verified (`http-probe.mjs`, `http-probe2.mjs`):**
  - `HTTP viewer after logout: {"data":{"viewer":null}}`.
  - `WS viewer after logout (same socket): {"data":{"viewer":{"email":"customer@example.com","role":"CUSTOMER"}}}`.
  - `WS myOrders after logout` returned the customer's orders.
  - `WS: 400 queries on one socket (HTTP limit is 300/min): 400 answered in 163ms`.
  - A `cancelOrder` mutation over WS was executed (it returned NOT_FOUND for a fake id, so it reached the resolver).
- **Fix:**
  - Re-validate the session in `onSubscribe`: call `resolveSession` per operation, or cache the result with a short TTL and close the socket with 4401 when it is gone.
  - Reject non-subscription operations in `onSubscribe` if WS is meant only for live updates. Otherwise apply a per-connection operation rate limit.

### F4. MEDIUM: transient PostgreSQL connection failures are classified PERMANENT, so jobs go straight to FAILED.
- **Where:** `packages/domain/src/retry.ts:8-45` (`classifyError`).
- **What is wrong:** these errors fall through to `PERMANENT`:
  - node-postgres connection loss: `Error('Connection terminated unexpectedly')`, which has no `code`;
  - `57P01` admin_shutdown, `57P02`, `57P03` cannot_connect_now, and `08003`/`08P01`;
  - any Elasticsearch `ResponseError` with status 500.
- **Failure scenario:** during a database restart or failover, `payment.authorize`, `refund.process` and `reservation.expire` jobs move to FAILED after one attempt. Payments and refunds then stall until an admin retries them by hand.
- **Verified:** `adversarial.ts` T8: `"Connection terminated unexpectedly"=PERMANENT 57P01=PERMANENT`.
- **Fix:**
  - Add class `08*` and `57P0x` SQLSTATEs.
  - Treat errors without a code from the pg driver (connection-terminated messages) as RETRYABLE.
  - Consider the opposite default: only known-permanent errors (validation, `PermanentJobError`, AppError, StockInvariantError) are PERMANENT. The attempt cap already bounds retries, once F2 is fixed.

### F5. LOW-MEDIUM: `@ofl/test-fixtures` `lint` and `test` scripts fail, which breaks the root `pnpm lint` and `pnpm test`.
- **Where:** `packages/test-fixtures/package.json` scripts (`eslint src tests`, `jest`). `packages/test-fixtures/tests/` is an empty directory.
- **Failure scenario:** the root scripts `pnpm lint` (`pnpm -r lint`) and `pnpm test` (`pnpm -r ... test`) stop at this package.
- **Verified:**
  - `pnpm --filter @ofl/test-fixtures lint` gives `No files matching the pattern "tests" were found` (exit 2).
  - `pnpm --filter @ofl/test-fixtures test` gives `Pattern: - 0 matches` (exit 1).
- **Fix:** add a fixture test (for example "the contract dataset reconciles" or "ids are deterministic"), or use `eslint src` plus `jest --passWithNoTests`.

### F6. LOW: a forged search cursor causes INTERNAL_SERVER_ERROR and an error-level log, instead of BAD_USER_INPUT.
- **Where:**
  - `packages/server-core/src/search/query-builder.ts:180-195`: the cursor is checked only for shape, not against the sort field types.
  - `search/service.ts:142-148`: an ES 400 is rethrown raw.
- **Verified:**
  - A cursor `["not-a-number","x"]` with `sort: PRICE_ASC` returned `{"code":"INTERNAL_SERVER_ERROR"}`.
  - `server.log` logged a level-50 entry: `Failed to parse search_after value for field [minPriceMinor]`.
  - Order cursors are fine: they returned `BAD_USER_INPUT`.
- **Fix:**
  - Encode the sort mode in the cursor and validate value types per sort (number for price and score, string or number for date, string for id).
  - Map ES 400 `search_phase_execution_exception` from a cursor to BAD_USER_INPUT.

### F7. LOW: non-UUID ids in staff filter arguments cause INTERNAL_SERVER_ERROR (PostgreSQL 22P02).
- **Where:**
  - `features/inventory/queries.ts` (`listBalances` `warehouseId`, `listMovements` `skuId`/`warehouseId`).
  - `features/orders/queries.ts:31` (`awaitingShipmentFromWarehouseId`).
- **Verified:** `nonuuid.ts` ran `inventoryMovements(skuId:"abc")`, `inventory(warehouseId:"abc")` and `orders(filter:{awaitingShipmentFromWarehouseId:"abc"})`. All three gave `INTERNAL_SERVER_ERROR`.
- **Fix:** validate them with `uuidSchema` and return BAD_USER_INPUT (or an empty page), the same way `parseEntityId` does.

### F8. LOW: the Fastify webhook validates the body schema before checking the signature.
- **Where:** `implementations/fastify/api/routes/webhook.ts:13-28,50-52`. This contradicts `handlePaymentWebhook`'s rule "Authenticate before parsing" (`notifications.ts:192`).
- **Verified:** an unsigned `{"foo":1}` returned `400 {"error":"body must have required property 'providerEventId'",...}`. Unauthenticated callers get schema feedback.
- **Fix:** drop the body schema (server-core already validates the body after the HMAC), or keep only a header schema.

### F9. LOW: `/metrics` and `/health/ready` are public, and readiness returns raw dependency error messages.
- **Where:** `implementations/fastify/api/routes/health.ts:8-16`, `packages/server-core/src/health.ts:32-33`.
- **Verified:** anonymous `GET /metrics` returned 200 with 22 KB. Readiness echoes `error.message` (for example an ECONNREFUSED host and port), by inspection.
- **Fix:** bind metrics to an internal port or listener (as the worker already does), and return a generic error string from readiness.

### F10. LOW (performance, by inspection only): every search-index job serializes on `search_index_state ... FOR UPDATE` plus an ES round trip.
- **Where:** `packages/server-core/src/search/service.ts:156-176,222-224`. `indexProducts` calls `ensureIndex` first. That opens a transaction, takes `FOR UPDATE` on the state row and calls `indices.exists` while holding it.
- **Impact:** all concurrent indexers (worker concurrency 4, several workers) queue on one row lock for every job.
- **Fix:** read the state with `FOR SHARE` first, and fall back to the `FOR UPDATE` create path only when no active index exists.

### F11. LOW: dead code, and order/reservation state machines that are never enforced.
- **Unused exports** (checked with grep across server-core, domain, Fastify, test-contracts and test-fixtures):
  - `updateOrderStatus` (`features/orders/records.ts`);
  - `enqueueSearchUpdateForProducts` (`features/catalog/search-events.ts:17`);
  - `isVersionConflict` (`search/client.ts:35`).
- **Never used for enforcement:** `ORDER_TRANSITIONS` and `RESERVATION_TRANSITIONS` (`packages/domain/src/state-machines.ts:23-36`).
  - Order and reservation status updates use ad-hoc SQL guarded by explicit checks. That is correct today, but the table in requirements §5 is documentation only for these two machines.
  - Payment and return transitions are asserted.
- **Fix:** delete the unused functions. Either call `assertTransition` for order and reservation changes, or state in the domain file that the tables are descriptive.

### F12. LOW: test-quality gaps.
- **S13 is lenient:** `packages/test-contracts/src/scenarios/s13-search-down.ts` accepts `['PENDING','FAILED']`. A connection-refused error must be RETRYABLE, so `PENDING` is the correct assertion. Accepting FAILED would hide a regression like F4.
- **S5 has a hedging comment:** `s05-payment-vs-expiry.ts` "Reservation movements may reference the order or the reservation; both count". The implementation always uses `reference_type='order'`. Assert that exactly.
- **Fastify HTTP tests do not cover:**
  - the GraphQL 300/min and webhook 120/min rate limits (only login is tested);
  - the `Secure` cookie flag under `NODE_ENV=production`;
  - cost or depth rejection over HTTP;
  - session revocation for an open WebSocket (F3);
  - graceful shutdown;
  - SPA fallback.
- **Process gap:** no test covers F1 or F2.

### F13. LOW (design question, contract level): `Sku.stock` exposes per-warehouse `onHand` and `reserved` to anonymous users.
- **Where:** `contracts/schema.graphql:90-99`, `resolvers/catalog.ts:65`.
- **Why it matters:** requirements §1 gives inventory viewing to operators, but this field shows exact warehouse stock and reservation counts to anyone. Customers only need `available`.
- **Fix (if unintended):** return `onHand`/`reserved` only for staff, or remove them from the public type.

### F14. LOW (readability, by inspection): business eligibility rules live in a resolver.
- **Where:** `packages/server-core/src/graphql/resolvers/orders.ts:20-59` (`allowedActions`) combines ownership, role and status rules in resolver code.
- **Why it matters:** `docs/architecture.md` §2 says resolvers "never contain business rules". It uses domain predicates, but the combination (for example "owner and not staff can request a return") is logic that belongs in a feature operation, such as `features/orders/allowed-actions.ts`.

### Note (not a defect)
- **No lease renewal:** jobs that run longer than 30 s can run twice at once. The handlers are idempotent (gateway keyed by payment or refund id, external_gte indexing), so this is acceptable as documented. A heartbeat would cut wasted work.
- **WebSocket close code:** on SIGTERM the socket closes with code 1005 (no close frame) instead of 1001. Clients reconnect anyway.

---

## Checks that passed

| Check | Command | Result |
| --- | --- | --- |
| Domain unit tests | `pnpm --filter @ofl/domain test` | 5 suites, 44/44 passed |
| Typecheck and lint for domain, graphql-types, test-contracts | `pnpm --filter <pkg> typecheck && lint` | clean (graphql-types lint is a no-op echo) |
| Typecheck test-fixtures | `pnpm --filter @ofl/test-fixtures typecheck` | clean (lint and test fail, see F5) |
| Typecheck and lint server-core (not its tests) | `pnpm --filter @ofl/server-core typecheck && lint` | clean |
| Fastify suite | `cd implementations/fastify && pnpm test` | 2 suites, 33/33 passed (14 acceptance + 19 HTTP), 8.8 s |
| Fastify typecheck, lint, build | `pnpm typecheck`, `pnpm lint`, `pnpm build` | clean; build produced `dist/api/server.js` and `dist/worker/main.js` |
| test-contracts helper tests | `pnpm --filter @ofl/test-contracts test` | 6/6 passed |
| Forbidden patterns | grep for `any`, `ts-ignore`, `ts-expect-error`, `eslint-disable`, TODO, FIXME in non-generated source | none found |
| Embedded SDL is current | compared `schema-sdl.ts` with `contracts/schema.graphql` | identical |
| CLI migrate, seed, reconcile | `ofl migrate`; `ofl-seed --profile contract`; `ofl reconcile` | 2 migrations applied; 2 products indexed; "ledger reconciles: no differences" |
| Overlapping multi-SKU checkouts in three different line orders, 60 concurrent | `adversarial.ts` T2 | 60/60 succeeded, 0 errors, no deadlock surfaced |
| Same idempotency key, different payloads, 10 concurrent | T3 | exactly 1 `succeeded:false`, matching-payload replays `succeeded:true`, others `idempotency_key_reused`; 1 order |
| Three concurrent `requestReturn` of 2 units each on a shipped line of 3 | T4 | `requested, quantity_exceeded, quantity_exceeded` |
| Another customer's `requestReturn` and `cancelOrder` | T4b | both NOT_FOUND |
| Cancel vs ship race, 15 iterations | T5 | 0 inconsistencies (14 cancel-won, 1 ship-won); cancelled orders have 0 shipments and 1 refund |
| Payment success vs customer cancel, 15 iterations, refunds processed | T6 | every order CANCELLED, payment REFUNDED with refunded = amount, exactly 1 RELEASE |
| Payment vs expiry race with past `expires_at`, 10 iterations | T9 | CONFIRMED with no refund, or CANCELLED with exactly 1 LATE_PAYMENT refund |
| Ledger after all adversarial runs | `reconcileLedger` | 0 differences |
| Login contract | `http-probe.mjs` | 200 with `HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`; 403 without CSRF; 401 bad password, all `{"error"}` |
| CSRF on GraphQL POST; mutation via GET | probe | 403 `CSRF_HEADER_MISSING`; 405 "Can only perform a mutation operation from a POST request" |
| Body limit | 110 KB GraphQL POST | 413 `PAYLOAD_TOO_LARGE` |
| Depth limit | 11-level introspection query | `QUERY_TOO_COMPLEX` "Query depth 11 exceeds the maximum of 10" |
| Webhook HMAC | tampered body with the original signature; valid shape unsigned | 401 for both |
| WebSocket Origin check | upgrade with `Origin: https://evil.example` | rejected 403 |
| Subscription isolation | customer2 subscribes to customer1's order; anonymous subscribes | NOT_FOUND; UNAUTHENTICATED. `order(id)` by customer2 gave NOT_FOUND |
| Order cursor tampering (SQL-ish payload) | `myOrders(after: forged)` | BAD_USER_INPUT |
| Log redaction | grep `server.log` and `shutdown.log` for the customer email and `ofl_session=` | 0 matches |
| Graceful shutdown with an open subscription | SIGTERM to the built server with a live `orderUpdated` socket | process exited within 1 s; "shutting down" logged; client socket closed |
| Elasticsearch recovers after the F1 burst | a single `searchProducts` afterwards | `{"totalCount":2}` |

Code read in full, no defect found:
- checkout (lock order, conditional reserve, stored failures, deadlock retry);
- `recordPaymentNotification` outcomes and duplicate handling, refunds, the gateway simulator;
- cancel and expiry, shipment, returns (warehouse split, refund amount = unit × qty);
- the ledger (`applyStockChanges` guard plus uniqueness index);
- the outbox fencing tokens (`locked_by` + `attempts`), the sweeper;
- search versioning (single-statement snapshot, `external_gte`, 409 treated as "older", FOR SHARE/FOR UPDATE handshake for alias switching during rebuild);
- the realtime hub (LISTEN reconnect wakes all subscribers), DataLoaders (fresh per request and per subscription event);
- error masking, session token hashing (SHA-256, 32 random bytes, format check), Argon2id with dummy verify for unknown emails;
- parameterized SQL everywhere: the only interpolations are constant column lists, the constant channel name and `timestampCursorSql` with constant column names.

## Things I could not verify

- **The server-core integration suite:** I was told not to run it, because of the concurrent `ofl_core_test` use.
- **Express, Next.js and web-spa behavior:** deferred to pass 2. I did not review web-spa beyond its role in the Fastify build.
- **The real throughput impact of F10:** no load test was run.
- **Rebuild with concurrent writes (alias switch while indexers run):** reviewed by inspection only. I did not run `ofl reindex` concurrently with writes.
- **Behavior during an actual PostgreSQL restart (F4) and realtime LISTEN reconnect:** classification was checked by calling `classifyError`. I did not restart the shared PostgreSQL, which is outside the allowed actions.
- **Elasticsearch-side metrics for F1:** the impact is inferred from latency, the SEARCH_UNAVAILABLE results and the server log.

## Leftovers

- Database `ofl_review` and the Elasticsearch indices with prefix `ofl_review_` are left for reproduction. Drop them with `psql -h localhost -U shohelshamim -d postgres -c 'DROP DATABASE ofl_review'` and `curl -XDELETE 'http://127.0.0.1:9200/ofl_review_*'`.
- Scratch scripts and logs are in `reports/review-scratch/`. No project source file was edited.
