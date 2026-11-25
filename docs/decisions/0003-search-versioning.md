# ADR 0003: External versions computed from PostgreSQL counters for search documents

## Status
Accepted.

## Context
Search events can arrive twice or out of order. A late event must not replace
newer product data in Elasticsearch.

## Options
1. Use the outbox event id as the version. Rejected: ids are assigned at insert
   time, and commit order can differ from insert order.
2. Keep one `search_version` column on `products` and increment it on every
   stock change. Rejected: every checkout would update the product row and
   create lock contention between different SKUs of one product.
3. Re-read PostgreSQL in the indexer and use a version derived from counters
   that every change already increments.

## Decision
Option 3. Version = `products.version + SUM(skus.version) + SUM(inventory_balances.version)`.
Index with `version_type: external_gte`.

## Reasons
Every relevant change increments at least one counter and no counter decreases,
so a later committed state has a greater or equal version. Equal versions mean
equal data, so `external_gte` accepts a harmless duplicate. The indexer always
re-reads current data, so the order of events does not matter.

## Consequences
A product with many SKUs needs a slightly larger read per indexing job. That is
cheap compared with the indexing request itself.
