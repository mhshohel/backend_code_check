# ADR 0001: Row locks in READ COMMITTED for stock reservations

## Status
Accepted.

## Context
Twenty customers can ask for the last five units at the same time. The system
must never reserve more than `on_hand - reserved`.

## Options
1. SERIALIZABLE isolation and retry on serialization failure.
2. READ COMMITTED with `SELECT ... FOR UPDATE` on the balance rows, locked in a fixed order.
3. A single conditional `UPDATE ... SET reserved = reserved + n WHERE on_hand - reserved >= n` per row, with no explicit lock.

## Decision
Option 2, plus the conditional update of option 3 as defense in depth, plus the
`reserved <= on_hand` CHECK constraint as the last line.

## Reasons
- Allocation across two warehouses needs to read several rows and decide. A
  lock makes that read-decide-write sequence safe and easy to explain.
- Locking `ORDER BY sku_id, warehouse_id` gives every transaction the same lock
  order, so two checkouts that share SKUs cannot deadlock in the normal path.
- Under SERIALIZABLE, contention on hot SKUs produces many aborts and retries.
  With row locks, waiting transactions queue and then see the committed values.

## Consequences
- Checkouts for the same SKU are serialized. Throughput on one hot SKU is limited
  by the transaction duration, so the transaction must stay short (no network calls).
- Deadlocks remain possible through other paths (for example an operator
  adjustment). The transaction helper retries `40P01` and `40001` up to 3 times.
