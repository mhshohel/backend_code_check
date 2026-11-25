# Requirements and shared specification

This document is the contract between the coordinator and the implementation
agents. All three variants (Express, Fastify, Next.js) implement the same
behavior. When code and this document disagree, fix one of them and record
the decision in `docs/decisions/`.

Related files:

- GraphQL contract: [`contracts/schema.graphql`](../contracts/schema.graphql)
- Client operations: [`contracts/operations/`](../contracts/operations/)
- Acceptance scenarios: [`contracts/acceptance-scenarios/scenarios.md`](../contracts/acceptance-scenarios/scenarios.md)
- Database schema: [`infrastructure/postgres/migrations/`](../infrastructure/postgres/migrations/)
- Pure business rules: [`packages/domain/src/`](../packages/domain/src/)

## 1. Roles

| Role | Can do |
| --- | --- |
| Customer | Search, view products, check out, view and cancel own orders, request returns for own orders, receive live updates for own orders. |
| Warehouse operator | Everything a customer can read, plus: view all orders, ship orders, receive returns, adjust inventory, view movement history. |
| Administrator | Everything an operator can do, plus: operations dashboard, failed jobs and retry, audit log, price changes. |

Authorization is enforced on the server in the application layer
(`@ofl/server-core`). Hidden UI controls are a convenience only.

Object-level rule: a customer who asks for another customer's order gets
`NOT_FOUND`, not `FORBIDDEN`. This does not reveal that the order exists.

## 2. Fixed business parameters

| Parameter | Value |
| --- | --- |
| Currency | USD, integer minor units (cents) |
| Warehouses | `WH-EAST` (priority 1), `WH-WEST` (priority 2) |
| Reservation hold time | 15 minutes (configurable, `RESERVATION_TTL_SECONDS`) |
| Session lifetime | 8 hours (configurable, `SESSION_TTL_SECONDS`) |
| Max cart lines | 20; max quantity per line 100 |
| Page size | default 20, max 50 |
| GraphQL max depth | 10 |
| GraphQL max cost | 5000 (see `docs/graphql-design.md`) |
| Timestamps | `timestamptz`, written and returned in UTC ISO-8601 |

## 3. Glossary

| Term | Meaning |
| --- | --- |
| SKU (stock keeping unit) | One sellable variant of a product, with its own price and stock. |
| On-hand | Physical units in a warehouse. |
| Reserved | Units promised to orders that have not shipped. |
| Available | On-hand minus reserved. Never stored. |
| Reservation | A hold of N units of one SKU in one warehouse for one order line. |
| Movement | One append-only ledger row that changes on-hand and/or reserved. |
| Idempotency key | A client-generated key that makes a retried checkout return the first result. |
| Outbox event | A row written in the same transaction as a business change. The worker processes it later. |
| Job | An outbox event while the worker processes it. The lab uses one table for both. |
| Lease | A time limit on a claimed job. An expired lease makes the job claimable again. |
| Search document | The Elasticsearch copy of a product. It is derived data and can be stale. |
| Correlation ID | A request identifier (`x-correlation-id`) copied to logs, audit rows, and outbox events. |

## 4. Inventory invariants

For every `(sku, warehouse)`:

1. `on_hand >= 0`, `reserved >= 0`, `reserved <= on_hand`. Enforced by CHECK constraints.
2. `on_hand = SUM(movements.on_hand_delta)` and `reserved = SUM(movements.reserved_delta)`.
   Every balance change writes a movement in the same transaction.
3. A movement kind has a fixed sign pattern (CHECK `movement_sign_pattern`).

| Movement | on_hand | reserved | Meaning |
| --- | --- | --- | --- |
| RECEIPT | +n | 0 | Goods arrive. |
| RESERVE | 0 | +n | Checkout holds stock. No physical movement. |
| RELEASE | 0 | −n | Hold ends (decline, expiry, cancellation). |
| SHIP | −n | −n | Reserved units leave the building. Consumes the hold. |
| RETURN_RESTOCK | +n | 0 | Returned units go back on the shelf. |
| ADJUSTMENT | ±n | 0 | Count correction. Cannot push on_hand below reserved. |

Reservation changes (RESERVE, RELEASE) change promises only. Physical
movements (RECEIPT, SHIP, RETURN_RESTOCK, ADJUSTMENT) change on-hand.

4. A movement with a reference is unique per
   `(reference_type, reference_id, kind, sku_id, warehouse_id)`. This blocks a
   second SHIP for one shipment and a second RETURN_RESTOCK for one return.

## 5. State machines

The tables live in `packages/domain/src/state-machines.ts`.

```
Order:        PENDING_PAYMENT -> CONFIRMED | CANCELLED
              CONFIRMED -> PARTIALLY_SHIPPED | SHIPPED | CANCELLED
              PARTIALLY_SHIPPED -> SHIPPED
Reservation:  ACTIVE -> CONFIRMED | RELEASED
              CONFIRMED -> SHIPPED | RELEASED
Payment:      PENDING -> CAPTURED | DECLINED
              CAPTURED -> PARTIALLY_REFUNDED | REFUNDED
              PARTIALLY_REFUNDED -> PARTIALLY_REFUNDED | REFUNDED
Return:       REQUESTED -> RECEIVED -> REFUNDED
```

## 6. Workflows

### 6.1 Checkout (`Mutation.checkout`)

1. Validate input (`checkoutInputSchema`). Require a signed-in CUSTOMER.
2. Compute `request_hash` = SHA-256 of the canonical JSON of
   `{lines sorted by skuId, paymentToken}`.
3. Start a READ COMMITTED transaction.
4. `INSERT INTO checkout_requests ... ON CONFLICT DO NOTHING`. If the row exists:
   - same hash: return the stored result with `replayed: true`;
   - different hash: return `IdempotencyKeyReused`.
   A concurrent request with the same key blocks on the unique index until
   the first transaction commits, then sees the committed row.
5. Load the SKUs. If any `expectedUnitPriceMinor` differs from the current
   price, store and return `PriceChanged`.
6. Lock the balance rows: `SELECT ... FROM inventory_balances WHERE sku_id = ANY($1)
   ORDER BY sku_id, warehouse_id FOR UPDATE`. The fixed order prevents deadlocks
   between two checkouts that share SKUs.
7. Run `allocateOrder` (domain). If short, store and return `InsufficientStock`.
   No stock changes.
8. Insert order, lines, reservations (`ACTIVE`, `expires_at = now + TTL`),
   RESERVE movements, the payment (`PENDING`), and update balances with
   `reserved = reserved + n WHERE reserved + n <= on_hand` (defense in depth).
9. Insert outbox events: `payment.authorize` (now), `reservation.expire`
   (`available_at = expires_at`), `search.product_changed` for each product.
10. Store the success result in `checkout_requests` and commit.
11. On SQLSTATE `40P01` or `40001`, roll back and retry the whole transaction
    up to 3 times with jittered backoff.

Steps 5 and 7 store a failure result inside the same transaction. A retry with
the same key returns the same failure. The client must use a new key after it
changes the cart.

### 6.2 Payment (simulated provider)

- The worker handles `payment.authorize`. It calls the simulated gateway
  (`simulated_gateway_operations`, idempotency key = payment id). The gateway
  returns the same provider event for the same key.
- Tokens: `tok_approve` succeeds, `tok_decline` declines,
  `tok_slow_approve` succeeds after the reservation hold time
  (used to demonstrate the expiry race in the UI).
- The worker then calls `recordPaymentNotification`, the same function that the
  HTTP webhook (`POST /webhooks/payments`) calls.
- `recordPaymentNotification`:
  1. Lock the order row (`FOR UPDATE`).
  2. Insert `payment_events` with `ON CONFLICT (provider_event_id) DO NOTHING`.
     If nothing was inserted, it is a duplicate: return without side effects.
  3. Success and order `PENDING_PAYMENT`: payment `CAPTURED`, order `CONFIRMED`,
     reservations `ACTIVE -> CONFIRMED` (no further expiry).
  4. Success and order `CANCELLED` (expired or cancelled first): payment
     `CAPTURED`, then create a `LATE_PAYMENT` refund and a `refund.process` job.
  5. Decline and order `PENDING_PAYMENT`: payment `DECLINED`, order `CANCELLED`
     (`PAYMENT_DECLINED`), release reservations once.
  6. Decline and order already `CANCELLED`: payment `DECLINED`, no stock change.

Webhook body: `{"providerEventId","paymentId","kind":"PAYMENT_SUCCEEDED"|"PAYMENT_DECLINED","amountMinor"}`.
Header `x-ofl-signature: sha256=<hex HMAC-SHA256 of the raw body with PAYMENT_WEBHOOK_SECRET>`.
Response: 200 with `{"status":"processed"|"duplicate"}`, 400 for a bad body, 401 for a bad signature.

### 6.3 Reservation expiry

- The `reservation.expire` job runs at `expires_at`. A sweeper in the worker
  also enqueues expiry for `ACTIVE` reservations past `expires_at` (safety net
  when a job is lost or delayed).
- Expiry locks the order row. If the order is still `PENDING_PAYMENT` and
  `now >= reservation_expires_at`: release all ACTIVE reservations, order
  `CANCELLED` (`RESERVATION_EXPIRED`). Otherwise do nothing.

### 6.4 Race rules (the winner is whoever locks the order row first)

| Race | Outcome |
| --- | --- |
| Payment success vs expiry | If payment locks first: order CONFIRMED, expiry is a no-op. If expiry locks first: order CANCELLED, stock released once, late payment is captured and fully refunded (`LATE_PAYMENT`). Payment after `expires_at` but before expiry runs still wins: the stock is still held. |
| Payment success vs customer cancel | Same rule. Cancel first: refund on late success. |
| Cancel vs ship | Ship requires CONFIRMED/PARTIALLY_SHIPPED; cancel requires zero shipments. Both lock the order row, so one of them sees the other's result. |
| Duplicate ship (same warehouse) | `UNIQUE (order_id, warehouse_id)` on shipments and the status check under lock: the second call returns `NothingToShip`. |
| Concurrent returns | `requestReturn` locks the order row, then sums existing return quantities. Excess returns `ReturnQuantityExceeded`. |
| Duplicate return receipt | Return status check under lock plus the movement uniqueness index. |

Lock order everywhere: `orders` row, then `inventory_balances` rows ordered by
`(sku_id, warehouse_id)`, then `payments`. Checkout creates a new order, so it
locks balances only.

### 6.5 Cancellation (`Mutation.cancelOrder`)

- Allowed for the owner or staff when `isCancellable` (PENDING_PAYMENT or
  CONFIRMED, no shipments).
- Releases ACTIVE/CONFIRMED reservations (RELEASE movements), sets order
  CANCELLED with `CUSTOMER_REQUEST` or `OPERATOR_REQUEST`.
- If the payment is CAPTURED, creates a `CANCELLATION` refund and a
  `refund.process` job.

### 6.6 Shipment (`Mutation.shipOrder`, operator)

- Lock the order. Require CONFIRMED or PARTIALLY_SHIPPED.
- Select CONFIRMED reservations for the given warehouse. None: `NothingToShip`.
- Insert shipment (tracking code generated when absent), shipment lines,
  SHIP movements (reference = shipment id), set reservations SHIPPED, update
  balances (`on_hand -= n, reserved -= n`).
- Order becomes SHIPPED when no CONFIRMED reservation remains, else PARTIALLY_SHIPPED.

### 6.7 Returns

- `requestReturn` (owner): order PARTIALLY_SHIPPED or SHIPPED; quantities within
  `returnableQuantity`. The refund amount is `unit_price × quantity` per line.
  Each return line records the warehouse that shipped the units (split by
  shipment quantities, earliest shipment first).
- `receiveReturn` (operator): REQUESTED -> RECEIVED, RETURN_RESTOCK movements
  (reference = return id), creates a `RETURN` refund and a `refund.process` job.
- `refund.process` (worker): calls the gateway refund (idempotency key =
  refund id), marks refund SUCCEEDED, adds to `payments.refunded_minor`,
  moves the payment to PARTIALLY_REFUNDED/REFUNDED, the return to REFUNDED.

### 6.8 Inventory adjustment (operator)

- RECEIPT: +n on-hand. ADJUSTMENT: ±n; rejected with `AdjustmentRejected`
  when `on_hand + n < reserved`.
- Writes a movement, an audit row, and a `search.product_changed` event.

### 6.9 Price change (administrator)

- Updates `skus.price_minor`, increments `skus.version`, writes an audit row
  and a `search.product_changed` event. Open carts see `PriceChanged` at checkout.

## 7. Outbox topics

| Topic | Producer | Consumer behavior (idempotent) |
| --- | --- | --- |
| `payment.authorize` | checkout | Gateway charge (idempotent key) then `recordPaymentNotification`. |
| `reservation.expire` | checkout, sweeper | Expire if still PENDING_PAYMENT and past expiry. |
| `refund.process` | cancel, return receipt, late payment | Gateway refund (idempotent key) then mark refund once. |
| `search.product_changed` | any change to product, SKU price, or stock | Re-read product from PostgreSQL, index with external version. |
| `order.changed` | every order state change | Live hint only: `pg_notify('order_events', orderId)` is sent in the same transaction; this row exists for metrics and audit. Consumer is a no-op. |

Job processing: claim with `FOR UPDATE SKIP LOCKED`, lease 30 seconds, max 8
attempts, backoff base 500 ms, cap 60 s. PERMANENT errors (domain
`classifyError`) go to FAILED immediately. Expired leases are reclaimable.
Operators retry FAILED jobs from the admin dashboard (`retryJob`) or the CLI.

## 8. Search

- Index alias `<prefix>products`, concrete index `<prefix>products_<timestamp>`.
- Document: id, slug, name (text + edge-ngram autocomplete subfield + keyword),
  description, category slug/name, min price (long, minor units), skus codes,
  `inStock`, `availableQuantity`, `createdAt`, `version`.
- Version = `products.version + SUM(skus.version) + SUM(inventory_balances.version)`
  for the product. Every relevant change increments at least one counter and
  none decrement, so a later committed state always has a version greater than
  or equal to an earlier one. Index with `version_type: external_gte`. A
  reordered or duplicate event re-reads PostgreSQL and can never overwrite a
  newer document with older data.
- Rebuild: create a new index, record it as `building_index`; the indexer
  writes to both the active and the building index while the rebuild bulk-loads
  every product; switch the alias atomically; clear `building_index`.
- Search unavailable: `searchProducts` returns GraphQL error
  `SEARCH_UNAVAILABLE`. The product detail page and checkout use PostgreSQL only.

## 9. Real-time order updates

- Transport: GraphQL over WebSocket with the `graphql-ws` protocol at path
  `/graphql` (Express, Fastify) or the Next.js realtime service port.
- Cross-process: every order change runs `pg_notify('order_events', orderId)`
  in its transaction. Each API process holds one `LISTEN order_events`
  connection and fans out to its subscribers. The subscription re-reads the
  order from PostgreSQL; the notification is only a hint.
- On subscribe the server sends the current order once. On reconnect the
  client subscribes again and therefore receives the current state. Events
  missed while disconnected are not replayed; the current state replaces them.

## 10. Security

- Password hashes: Argon2id (`@node-rs/argon2`).
- Session: random 32-byte token in cookie `ofl_session`; SHA-256 hash in
  `sessions`; `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` in production;
  server-side expiry and logout revocation.
- CSRF (cross-site request forgery): SameSite=Lax cookie plus a required
  `x-ofl-csrf: 1` header on every state-changing request (GraphQL POST, login,
  logout). Browsers cannot add custom headers cross-site without a CORS
  preflight, and CORS allows only the variant's own web origin.
- Rate limits: login 10/min per IP; GraphQL 300/min per IP; webhook 120/min.
- Auth HTTP contract (all variants): `POST <auth>/login` JSON `{email,password}` →
  200 `{"user":{id,email,displayName,role}}` + Set-Cookie; 400 `{"error"}` bad input;
  401 `{"error"}` invalid credentials; 403 `{"error"}` missing CSRF header;
  429 `{"error"}` rate limited. `POST <auth>/logout` → 204 and an expired cookie.
- WebSocket origin check: reject an upgrade whose `Origin` header is present and
  not in the allowlist; accept a missing Origin (non-browser clients). The
  session cookie is still required for private subscriptions.
- Body limit 100 KB. Parameterized SQL only. No secrets or customer emails in logs.

## 11. Ports and isolated resources

| Variant | API / app | Web (dev) | Realtime | Worker health | Database | Test database | ES prefix |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Express | 4100 | 4101 | 4100 | 4102 | `ofl_express` | `ofl_express_test` | `ofl_express_` |
| Fastify | 4200 | 4201 | 4200 | 4202 | `ofl_fastify` | `ofl_fastify_test` | `ofl_fastify_` |
| Next.js | 4300 | 4300 | 4301 | 4302 | `ofl_nextjs` | `ofl_nextjs_test` | `ofl_nextjs_` |
| Shared package tests | – | – | – | – | `ofl_core_test` | – | `ofl_coretest_` |

Test index prefixes add `test_` (for example `ofl_express_test_`).

## 12. Demo accounts

| Email | Password | Role |
| --- | --- | --- |
| `customer@example.com` | `customer-pass-1` | CUSTOMER |
| `customer2@example.com` | `customer-pass-2` | CUSTOMER |
| `operator@example.com` | `operator-pass-1` | OPERATOR |
| `admin@example.com` | `admin-pass-1` | ADMIN |

These accounts exist only in local seed data.
