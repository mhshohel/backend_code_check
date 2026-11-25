# Database design

PostgreSQL is the source of truth. Elasticsearch holds derived data only.

## Tables and their purpose

| Table | Purpose | Key constraints |
| --- | --- | --- |
| `users`, `sessions` | Identity and server-side sessions | unique `lower(email)`; unique `token_hash` |
| `categories`, `products`, `skus`, `warehouses` | Catalog | unique slugs/codes; `price_minor >= 0`; one currency |
| `inventory_balances` | Current stock per SKU and warehouse | `on_hand >= 0`, `reserved >= 0`, `reserved <= on_hand` |
| `inventory_movements` | Append-only stock ledger | sign pattern per kind; unique per `(reference, kind, sku, warehouse)` |
| `orders`, `order_lines` | Orders with price snapshots | `line_total = unit_price × quantity`; cancellation reason iff CANCELLED |
| `reservations` | Holds per line and warehouse | unique `(order_line_id, warehouse_id)` |
| `checkout_requests` | Idempotency keys with stored results | primary key `(customer_id, idempotency_key)` |
| `payments`, `payment_events`, `refunds` | Simulated payments | unique `order_id`; unique `provider_event_id`; `refunded <= amount`; one refund per return |
| `simulated_gateway_operations` | The fake provider's own state | primary key = idempotency key |
| `shipments`, `shipment_lines` | Fulfillment | unique `(order_id, warehouse_id)` |
| `returns`, `return_lines` | Returns | quantity > 0 |
| `outbox_events` | Transactional outbox and job queue | status CHECK; partial index on unfinished rows |
| `search_index_state` | Active and building index for alias switching | |
| `audit_log` | Sensitive changes with actor and correlation ID | |

## Transaction boundaries

| Operation | One transaction contains |
| --- | --- |
| Checkout | idempotency row, order, lines, reservations, RESERVE movements, balance updates, payment, outbox events, notify |
| Payment notification | payment event, payment status, order status, reservation status (or release), refund + job when late, notify |
| Expiry | order cancel, reservation release, RELEASE movements, balance updates, notify |
| Cancellation | same as expiry, plus refund + job when captured |
| Shipment | shipment, lines, SHIP movements, balances, reservations, order status, outbox, notify |
| Return request | return and lines (after locking the order) |
| Return receipt | return status, RETURN_RESTOCK movements, balances, refund, job, outbox, notify |
| Adjustment | balance, movement, audit row, outbox |
| Job completion | the handler's own transaction, then a separate status update of the job |

No transaction calls Elasticsearch or the payment gateway. Those calls happen
in the worker, outside business transactions.

## Locking and isolation

READ COMMITTED everywhere (the PostgreSQL default). Correctness comes from:

1. `SELECT ... FOR UPDATE` on the order row before any order state change.
2. `SELECT ... FOR UPDATE` on balance rows `ORDER BY sku_id, warehouse_id`.
3. Conditional updates (`WHERE reserved + $n <= on_hand`) and CHECK constraints
   as the last line of defense.
4. Unique indexes that turn duplicates into conflicts (`payment_events`,
   `shipments`, `inventory_movements`, `checkout_requests`, `refunds`).

See [ADR 0001](decisions/0001-postgresql-row-locks-for-reservations.md).

## Ledger reconciliation

```sql
SELECT b.sku_id, b.warehouse_id, b.on_hand, b.reserved,
       COALESCE(SUM(m.on_hand_delta), 0)  AS ledger_on_hand,
       COALESCE(SUM(m.reserved_delta), 0) AS ledger_reserved
FROM inventory_balances b
LEFT JOIN inventory_movements m USING (sku_id, warehouse_id)
GROUP BY b.sku_id, b.warehouse_id, b.on_hand, b.reserved
HAVING b.on_hand  <> COALESCE(SUM(m.on_hand_delta), 0)
    OR b.reserved <> COALESCE(SUM(m.reserved_delta), 0);
```

An empty result means the balances match the ledger. The acceptance suite runs
this after every scenario (`reconcileLedger`), and `ofl reconcile` runs it on demand.

## Indexes and the queries they serve

| Index | Query |
| --- | --- |
| `orders_customer_created_idx (customer_id, created_at DESC, id DESC)` | "My orders" keyset page. Added in migration 0002 after measurement. |
| `orders_status_created_idx (status, created_at DESC, id DESC)` | Operator lists filtered by status. |
| `reservations_active_expiry_idx (expires_at) WHERE status = 'ACTIVE'` | Expiry sweeper. Partial: confirmed and shipped holds are excluded. |
| `reservations_confirmed_wh_idx (warehouse_id, created_at) WHERE status = 'CONFIRMED'` | Fulfillment queue per warehouse. |
| `outbox_claimable_idx (available_at, id) WHERE status IN ('PENDING','PROCESSING')` | Worker claim. DONE rows stay out of the index. |
| `inventory_movements_sku_wh_idx (sku_id, warehouse_id, id DESC)` | Movement history page. |
| `audit_log_entity_idx (entity_type, entity_id, id DESC)` | Audit history per entity. |

## Keyset pagination

Pages use `(created_at, id)` as the sort key and `id` as the tie-breaker:

```sql
WHERE customer_id = $1
  AND (created_at, id) < ($2, $3)   -- values from the cursor
ORDER BY created_at DESC, id DESC
LIMIT $4 + 1                         -- one extra row tells hasNextPage
```

A row inserted during paging appears on page 1 of a fresh query and never
shifts later pages, unlike `OFFSET`.

## Connection pooling and bounded execution

Each process has one `pg.Pool` (`DB_POOL_MAX`, default 10) with
`statement_timeout` (`STATEMENT_TIMEOUT_MS`, default 5000) set on every
connection. The realtime listener uses one extra dedicated connection.
Total connections = processes × (pool max + 1); keep this below the server's
`max_connections` (100 on the local server).

## When partitioning or replicas would be justified

Not used. Measured volumes (see [performance.md](performance.md)) fit
comfortably in one node. Partitioning `inventory_movements` or `outbox_events`
by month becomes useful when retention deletes become expensive (hundreds of
millions of rows). Read replicas help when read traffic (search fallback,
reports) competes with checkout writes; checkout and payment reads must stay
on the primary because they need the latest committed state.
