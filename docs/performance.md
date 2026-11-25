# Performance verification

This page records provisional targets, the method, and the observed results.
Targets were written on 2026-11-25 **before** any measurement. Observed results
are in section 4 and in [`reports/`](../reports/).

A laptop benchmark shows relative behavior and regressions. It does not prove
production scalability.

## 1. Provisional targets (set before measuring)

| Scenario | Dataset | Concurrency | Target p50 | Target p95 | Target errors |
| --- | --- | --- | --- | --- | --- |
| Product search (text + 1 filter + facets) | bench: 20 000 products | 20 connections | ≤ 30 ms | ≤ 100 ms | 0 % |
| "My orders" first page (20) | bench: 200 000 orders, heavy customer with 5 000 orders | 20 connections | ≤ 20 ms | ≤ 60 ms | 0 % |
| Database query for "my orders" page (EXPLAIN ANALYZE) | same | 1 | ≤ 2 ms | – | – |
| Concurrent checkout, distinct SKUs | bench | 50 connections | ≤ 60 ms | ≤ 200 ms | 0 % non-business errors |
| Concurrent checkout, one hot SKU | bench | 50 connections | – | ≤ 500 ms | 0 % non-business errors, 0 oversell |
| Worker throughput (`search.product_changed`) | 5 000 queued jobs | 4 concurrent claims | ≥ 200 jobs/s | lag p95 ≤ 5 s | 0 failed |

## 2. Method

Prerequisites:

1. Elasticsearch is running (`pnpm infra:up`).
2. The `ofl_bench` database exists (`pnpm db:create`).

Procedure:

1. Load the bench dataset: see the command in section 3.
2. Run each scenario with the benchmark script. Each run has a warm-up phase
   that is not recorded.
3. Record hardware, dataset size, concurrency, duration, throughput, p50, p95,
   and error rate.

## 3. Commands

- `pnpm bench` — HTTP scenarios and worker ([`scripts/bench/run-benchmarks.ts`](../scripts/bench/run-benchmarks.ts)).
- `DATABASE_URL=.../ofl_bench pnpm bench:explain` — "my orders" before/after migration 0002.
- `tsx scripts/bench/checkout-profile.ts full|minimal` — checkout transaction vs response cost.

## 4. Observed results

- Load scenarios, targets vs observed, caveats: [README "Benchmark report"](../README.md#benchmark-report) and [`reports/benchmarks.md`](../reports/benchmarks.md).
- Migration 0002 (keyset index): [`reports/explain-my-orders.md`](../reports/explain-my-orders.md). First measurement with a 5,000-order customer: p50 1.751 → 0.007 ms. The final report ran after extra load runs, when the customer had 26,720 orders: p50 5.374 → 0.009 ms.
- Migration 0003 (`shipment_lines` index): [`reports/checkout-profile.md`](../reports/checkout-profile.md). Checkout at 50 connections: 108.8 → 1345.8 req/s, p50 414.7 → 36.6 ms.
- Targets missed: "my orders" p95 for one variant per run (Fastify in run 1, Express in run 3). The tail follows host load spikes from unrelated processes, not the framework; each report records the load average. Worker backlog lag p95 also missed: the target was unrealistic for a 5,000-job burst.
- Reports: [`benchmarks.md`](../reports/benchmarks.md) (run 1, main result), [`benchmarks-run3-under-load.md`](../reports/benchmarks-run3-under-load.md), [`benchmarks-rerun-fastify-under-load.md`](../reports/benchmarks-rerun-fastify-under-load.md).
