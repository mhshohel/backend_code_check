# Acceptance scenarios

Every implementation must pass these scenarios. The executable versions live
in [`packages/test-contracts`](../../packages/test-contracts). Each
implementation runs the same suite against its own running API, database, and
search index prefix.

Common prerequisites for every scenario:

- The target API is running with its test database and test index prefix.
- The test database is migrated and reset to the "contract" fixture
  (`@ofl/test-fixtures`): 2 warehouses, 4 demo accounts, a small catalog.
- The suite signs in through the variant's login endpoint and sends GraphQL
  requests over HTTP with the session cookie and `x-ofl-csrf: 1`.
- The target runs with `ENABLE_QUERY_COUNT=true` and with rate limits raised or
  disabled through a test-only server option. Production defaults stay unchanged.
- No worker process runs beside the target. The suite drives jobs itself with
  `runWorkerUntilIdle({ jobIds })`.
- Extra customer sessions (S1) are created with `login()` in-process; bulk
  setup orders (S5, S12) use `executeOperation`. This keeps setup below the
  login rate limit and keeps the tests focused on the scenario under test.
- WebSocket upgrades without an `Origin` header are accepted (non-browser
  clients send none). A present Origin outside the allowlist is rejected.
- Asynchronous checks use bounded polling (maximum 10 s, 50 ms interval),
  never fixed sleeps.

Verification helpers read PostgreSQL directly (`balances`, `movements`,
`reconcileLedger`). `reconcileLedger` must report zero differences after every
scenario.

---

## S1. Last five units, twenty concurrent customers

- **Setup:** SKU `LAST-5` has on_hand 5, reserved 0, in WH-EAST only. 20 customer accounts.
- **Action:** 20 customers call `checkout` for 1 unit of `LAST-5` at the same time (each with its own idempotency key).
- **Expected:** exactly 5 `CheckoutSucceeded`, exactly 15 `InsufficientStock`. No GraphQL errors.
- **Verification:** balance on_hand 5, reserved 5; 5 RESERVE movements; 5 orders; ledger reconciles.

## S2. Concurrent retries with one idempotency key

- **Setup:** SKU with ample stock. One customer.
- **Action:** send the same `checkout` (same key, same payload) 10 times concurrently.
- **Expected:** all 10 responses are `CheckoutSucceeded` with the same order id; exactly 1 has `replayed: false`.
- **Verification:** 1 order, 1 reservation, reserved increased by the requested quantity once. A further request with the same key and a different quantity returns `IdempotencyKeyReused`.

## S3. Declined payment releases stock once

- **Setup:** SKU with on_hand 10.
- **Action:** checkout 2 units with `tok_decline`; the worker processes `payment.authorize`.
- **Expected:** order becomes `CANCELLED` with `PAYMENT_DECLINED`; payment `DECLINED`.
- **Verification:** reserved back to 0; exactly one RESERVE and one RELEASE movement for the order. Processing the same job again changes nothing.

## S4. Duplicate payment notifications

- **Setup:** order in PENDING_PAYMENT (worker not running).
- **Action:** POST the same signed `PAYMENT_SUCCEEDED` webhook 5 times (3 concurrently, then 2 sequentially).
- **Expected:** first processed response `processed`, all others `duplicate`; order `CONFIRMED`.
- **Verification:** 1 `payment_events` row; reservations CONFIRMED; payment CAPTURED; no extra movements. A webhook with a bad signature returns 401.

## S5. Payment confirmation races with expiration

- **Setup:** two orders with reservation hold already past `expires_at` (test clock / direct update of `expires_at`).
- **Action:** for each order, run `recordPaymentNotification(success)` and `expireReservation` concurrently, 20 iterations with fresh orders.
- **Expected:** each order ends either CONFIRMED (payment won) with reservations CONFIRMED, or CANCELLED/RESERVATION_EXPIRED (expiry won) with a LATE_PAYMENT refund.
- **Verification:** for every order, RESERVE count = 1 per reservation and RELEASE count is 0 (payment won) or 1 (expiry won); reserved never negative; ledger reconciles.

## S6. Multi-item checkout fails atomically

- **Setup:** SKU A on_hand 10, SKU B on_hand 1.
- **Action:** checkout A×2 and B×2.
- **Expected:** `InsufficientStock` listing only SKU B (requested 2, available 1).
- **Verification:** no order row, no reservation, A and B reserved unchanged, no movements.

## S7. Worker stops after an external side effect, before acknowledgement

- **Setup:** order with `tok_approve` and a pending `payment.authorize` job.
- **Action:** run the job with a fault hook that throws after the gateway charge and before the job is marked DONE (simulated crash; lease left in place). Let the lease expire. Run the worker again.
- **Expected:** the job is reclaimed and completes; order CONFIRMED.
- **Verification:** 1 gateway CHARGE row, 1 `payment_events` row, job DONE with attempts ≥ 2, ledger reconciles.

## S8. Duplicate or reordered search events

- **Setup:** product indexed.
- **Action:** change the SKU price twice (v1 then v2). Process the `search.product_changed` events in reverse order, then process the first one again.
- **Expected:** the indexed document shows the v2 price and the latest version.
- **Verification:** ES document `version` equals the PostgreSQL computed version; `searchProducts` returns the v2 price.

## S9. One order ships from two warehouses

- **Setup:** SKU X: WH-EAST on_hand 2, WH-WEST on_hand 3.
- **Action:** checkout X×4 (no single warehouse has 4, so allocation splits EAST 2 + WEST 2), confirm payment, operator ships from WH-EAST, ships WH-EAST again, then ships from WH-WEST, then ships WH-EAST once more.
- **Expected:** after the first shipment `PARTIALLY_SHIPPED`; the repeat while PARTIALLY_SHIPPED returns `NothingToShip`; after the WH-WEST shipment `SHIPPED`; the final repeat returns `OrderNotShippable` (status SHIPPED), as required by the state machine in requirements §6.6.
- **Verification:** 2 shipments; SHIP movements −2 in each warehouse; reserved 0 in both; on_hand EAST 0, WEST 1.

## S10. Partial return restocks once

- **Setup:** shipped order with line quantity 3.
- **Action:** customer requests a return of 2 units; operator receives it twice (sequentially and concurrently); worker processes the refund. Customer then requests 2 more units.
- **Expected:** first receive `ReturnReceived`, repeats `ReturnNotReceivable`; second request `ReturnQuantityExceeded` (returnable 1).
- **Verification:** exactly one RETURN_RESTOCK movement of +2; payment PARTIALLY_REFUNDED with refunded = 2 × unit price; return REFUNDED.

## S11. Customer isolation

- **Setup:** order owned by customer A.
- **Action:** customer B queries `order(id)`, calls `cancelOrder`, `requestReturn`, and subscribes to `orderUpdated` for that order. A customer calls `shipOrder` and `adjustInventory`.
- **Expected:** B gets `NOT_FOUND` for every order access; customer gets `FORBIDDEN` for operator mutations; an anonymous request gets `UNAUTHENTICATED`.
- **Verification:** the order and stock are unchanged.

## S12. No per-order queries

- **Setup:** an operator and N orders with 2 lines each, for N = 5, 20, 50.
- **Action:** run `OperatorOrders(first: N)` with header `x-ofl-debug-query-count: 1` (enabled only when `ENABLE_QUERY_COUNT=true`).
- **Expected:** `extensions.queryCount` is the same for N = 5, 20, and 50 (constant, not growing with N).
- **Verification:** the reported count is at most 15.

## S13. Elasticsearch failure does not affect checkout

- **Setup:** the API is started with an Elasticsearch URL that refuses connections (or the client is closed).
- **Action:** run `searchProducts`, then `product(slug)`, then `checkout`.
- **Expected:** `searchProducts` fails with `SEARCH_UNAVAILABLE`; `product` succeeds from PostgreSQL; `checkout` succeeds; the `search.product_changed` job retries and stays PENDING/FAILED without losing the event.
- **Verification:** stock and order are correct in PostgreSQL; ledger reconciles.

## S14. Live updates across API processes

- **Setup:** two API processes (or two server instances in one test) sharing the database.
- **Action:** a client subscribes to `orderUpdated` on instance 1. The payment is confirmed through instance 2 (webhook). The client disconnects, the order ships while disconnected, and the client reconnects.
- **Expected:** the subscription first emits PENDING_PAYMENT, then CONFIRMED. After reconnect the first emitted event shows SHIPPED.
- **Verification:** no event is emitted for another customer's order.
