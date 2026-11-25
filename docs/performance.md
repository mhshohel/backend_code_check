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

See section 4 for the commands that produced each result.

## 4. Observed results

Pending. This section is filled only with measured values.
