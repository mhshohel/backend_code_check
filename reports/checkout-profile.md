# Checkout profile: before and after migration 0003

Measured on 2026-11-25 with `scripts/bench/checkout-profile.ts` against the
Express variant (`scripts/bench/serve.ts express 4180`) on the bench dataset
(20,060 products, 200,039 orders, 300,040 shipment lines). Apple M3 Max,
PostgreSQL 17 local. Each row: 1 s warm-up, 4 s measured, one SKU per request.

## Step 1: separate the transaction from the response

Before migration 0003.

| Response selection | Connections | Throughput (req/s) | p50 ms | p95 ms |
| --- | --- | --- | --- | --- |
| minimal (`order { id }`) | 1 | 174.5 | 3.0 | 14.3 |
| minimal | 10 | 1482.0 | 5.4 | 13.3 |
| minimal | 50 | 2055.3 | 21.8 | 41.0 |
| full (`OrderDetailFields`) | 1 | 81.5 | 12.2 | 13.7 |
| full | 10 | 116.8 | 54.6 | 204.1 |
| full | 50 | 108.8 | 414.7 | 563.9 |

The checkout transaction scales well. With the full response, throughput stops
at about 110 req/s, so the cost is in resolving the response.

## Step 2: find the slow query

`EXPLAIN (ANALYZE, BUFFERS)` of the `shippedQuantityByLine` DataLoader query
(`packages/server-core/src/graphql/loaders.ts`):

```
Parallel Seq Scan on shipment_lines  (actual time=4.229..6.100 rows=1 loops=2)
  Filter: (order_line_id = ANY ((InitPlan 1).col1))
  Rows Removed by Filter: 150019
  Buffers: shared hit=2501
```

The primary key of `shipment_lines` is `(shipment_id, order_line_id)`. A lookup
by `order_line_id` alone cannot use it, so every order detail scanned all
300,040 rows. A query over `pg_constraint` showed that this was the only
unindexed foreign key that the application queries by.

## Step 3: add the index and measure again

Migration `0003_shipment_lines_order_line_index.sql`:
`CREATE INDEX shipment_lines_order_line_idx ON shipment_lines (order_line_id);`

| Response selection | Connections | Throughput (req/s) | p50 ms | p95 ms |
| --- | --- | --- | --- | --- |
| full | 1 | 312.5 | 3.0 | 5.6 |
| full | 10 | 1214.3 | 7.4 | 10.6 |
| full | 50 | 1345.8 | 36.6 | 43.2 |

At 50 connections: throughput 108.8 → 1345.8 req/s (12×), p50 414.7 → 36.6 ms.
