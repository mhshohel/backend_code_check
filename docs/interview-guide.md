# Interview guide

Questions an interviewer can ask about this kind of system, each with a short
answer tied to this code. Read the linked file before you answer in your own
words. Section 10 has practice exercises; they are not part of the required
features.

Paths below are relative to `packages/server-core/src/` unless stated.

## 1. Preventing overselling

**Q: Twenty customers want the last five units at the same moment. How do you
make sure exactly five succeed?**

Checkout locks the balance rows with `SELECT ... FOR UPDATE` in one
transaction, then allocates, then updates `reserved`. A second transaction
waits on the lock and then sees the committed `reserved` value. The update also
has a condition (`reserved + n <= on_hand`), and a CHECK constraint
(`reserved <= on_hand`) is the last line of defense. Scenario S1 proves it.
Files: [`features/inventory/ledger.ts`](../packages/server-core/src/features/inventory/ledger.ts),
[`features/checkout/operations.ts`](../packages/server-core/src/features/checkout/operations.ts).

**Q: Why not just check availability and then update?** Between the check and
the update another transaction can commit. That is a lost update. The lock
makes the read and the write one step.

**Q: Why are rows locked in `ORDER BY sku_id, warehouse_id`?** Two checkouts
for SKUs A and B could lock A then B and B then A and deadlock. A fixed order
removes that cycle. Deadlocks from other paths are retried (`40P01`).

## 2. Isolation level and locks

**Q: Why READ COMMITTED and not SERIALIZABLE?** With SERIALIZABLE, contention
on a hot SKU causes many serialization failures and retries. With explicit row
locks, transactions queue instead of failing. READ COMMITTED gives each
statement a fresh snapshot, so the waiting transaction sees the committed value
after the lock is released. See [ADR 0001](decisions/0001-postgresql-row-locks-for-reservations.md).

**Q: What decides the winner when payment confirmation and reservation expiry
happen at the same time?** Both lock the order row first. Whoever gets the lock
first wins; the other sees the new state and does nothing, or, for a late
payment, refunds it. [requirements.md §6.4](requirements.md#64-race-rules-the-winner-is-whoever-locks-the-order-row-first),
scenario S5, [`features/payments/notifications.ts`](../packages/server-core/src/features/payments/notifications.ts),
[`features/orders/operations.ts`](../packages/server-core/src/features/orders/operations.ts).

## 3. Duplicate requests

**Q: The client times out and retries checkout. How do you avoid two orders?**
The client sends an idempotency key. The server inserts
`(customer_id, key, request_hash)` into `checkout_requests` inside the checkout
transaction with `ON CONFLICT DO NOTHING`. A concurrent duplicate waits on the
unique index, then reads the stored result. A different payload with the same
key returns `IdempotencyKeyReused`. Business failures are stored too, so a retry
returns the same answer. Scenario S2.

**Q: The payment provider sends the same webhook three times.** Each event has
a provider ID with a unique constraint in `payment_events`. The insert that
loses the race inserts nothing, and the handler returns `duplicate` without
side effects. Scenario S4.

**Q: How do you stop a second shipment or a second restock?** Unique keys:
`shipments (order_id, warehouse_id)` and
`inventory_movements (reference_type, reference_id, kind, sku_id, warehouse_id)`.
The application checks state under a lock; the database enforces it anyway.

## 4. Avoiding N+1 queries

**Q: A page of 50 orders shows lines, reservations, payments, and shipments.
How many queries run?** Ten, the same for 5, 20, or 50 orders (measured in
`reports/benchmarks.md`). Each nested field uses a DataLoader that collects keys
during one tick and runs one `WHERE id = ANY($1)` query.
File: [`graphql/loaders.ts`](../packages/server-core/src/graphql/loaders.ts).

**Q: Why are DataLoaders created per request?** A shared cache would serve one
user's data to another and would keep stale data. A request-scoped cache is
safe and still removes duplicate loads within the request.

**Q: How do you stop a client from sending a very expensive query?** Depth
limit, a cost limit in which list fields multiply by `first`, page size limits,
and body size limits. File: [`graphql/limits.ts`](../packages/server-core/src/graphql/limits.ts).

## 5. Synchronizing search safely

**Q: Why not write to Elasticsearch in the request?** If the PostgreSQL commit
succeeds and the Elasticsearch write fails (or the reverse), the two disagree
with no record of the difference. The request writes an outbox row in the same
transaction instead; the worker updates the index later.

**Q: Events arrive twice or out of order. How do you avoid stale documents?**
The indexer ignores the event content and re-reads the product from
PostgreSQL. It writes with an external version computed from counters that only
grow, using `version_type: external_gte`. An older state can never replace a
newer one. Scenario S8, [ADR 0003](decisions/0003-search-versioning.md),
[`search/service.ts`](../packages/server-core/src/search/service.ts).

**Q: How do you rebuild the index without downtime?** Build a new index behind
the alias, write live updates to both indexes during the build, switch the alias
atomically, delete the old index. `ofl reindex`.

## 6. Recovering interrupted jobs

**Q: A worker crashes after charging the card but before marking the job done.**
The job has a lease. After it expires, another worker claims the job. The
gateway call uses the payment ID as its idempotency key and returns the same
result; the duplicate notification is a no-op. The final state is correct, and
the card is charged once. Scenario S7, [`outbox/outbox.ts`](../packages/server-core/src/outbox/outbox.ts).

**Q: Is this exactly-once delivery?** No. Delivery is at least once. The effect
is applied once because every handler is idempotent.

**Q: How do two workers avoid claiming the same job?** `FOR UPDATE SKIP LOCKED`
in the claim query: a row locked by one worker is skipped by the others.

## 7. Separating frontend state

**Q: Where does each kind of state live in the React SPA?**

| State | Where | Example |
| --- | --- | --- |
| Remote data | urql cache only | products, orders |
| URL state | search params | filters, sort, cursor |
| Local form state | component state | return quantities, adjustment form |
| Shared client state | Redux Toolkit | cart, checkout attempt with its idempotency key, toasts |

Server data is never copied into Redux, so there is one source of truth for it.
Files: [`packages/web-spa/src`](../packages/web-spa/src).

**Q: Why is the checkout idempotency key in Redux?** It must survive a network
failure and a retry click, and be cleared only after a definitive result.

## 8. Rendering and caching in Next.js

**Q: Which parts are Server Components?** Catalog, product, order, warehouse,
and admin pages. They call the application layer in-process
(`executeOperation`), with no HTTP call back to the same server. Interactive
workflows are client components that send GraphQL mutations, then call
`router.refresh()`. See [`implementations/nextjs/README.md`](../implementations/nextjs/README.md).

**Q: How do you keep one user's page out of another user's cache?** Pages that
read the session cookie are dynamic, and user-specific responses carry
`Cache-Control: private, no-store`. Only anonymous search results are cached,
for 15 seconds, with the index prefix in the cache key. Checkout rechecks
PostgreSQL, so stale search data cannot cause an oversell.

**Q: Why does the Next.js variant have a separate realtime process?** Route
handlers cannot upgrade a connection to WebSocket. A small Node process hosts
graphql-ws and shares the cookie because cookies are scoped by host, not port.

## 9. Identifying scaling limits

**Q: What breaks first under more load?**

1. One hot SKU: checkouts for it queue on one row lock. Throughput is bounded
   by transaction time. Mitigation: keep the transaction short; shard stock
   into buckets if needed.
2. PostgreSQL connections: each process holds `DB_POOL_MAX + 1`. Many
   instances need a pooler such as PgBouncer (transaction mode is not compatible
   with `LISTEN`, which needs a dedicated session connection).
3. The outbox table: DONE rows accumulate; the partial index keeps claims fast,
   but retention and possibly partitioning become necessary.
4. Rate limits are per process; a shared store is needed for several instances.

**Q: Show a measured optimization.** Two, in [performance.md](performance.md):
the "my orders" keyset index (1.751 ms → 0.007 ms) and the `shipment_lines`
index that raised checkout throughput from 108.8 to 1,345.8 requests/s.

## 10. Exercises (optional practice, not required features)

1. Add a retention job that deletes `DONE` outbox rows older than 7 days in
   small batches. Measure the claim query before and after with 1 million DONE rows.
2. Move rate limits to PostgreSQL or Redis so several instances share them.
   Write a test with two server instances.
3. Add a `PARTIALLY_RETURNED` order status. Update the state machine, the
   tests, and the UI. Note how many places change.
4. Add point-in-time search pagination (Elasticsearch PIT) and compare results
   when products change between pages.
5. Make the reservation hold time depend on the payment method. Where does the
   rule belong: domain, server-core, or the UI?
6. Run two worker processes and kill one during a backlog of 5,000 jobs.
   Measure how long recovery takes with leases of 30 s and 5 s.
