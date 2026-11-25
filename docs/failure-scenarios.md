# Failure scenarios and recovery

Each entry gives the failure, what the system does, how to reproduce it, and
how to recover. Commands run inside a variant folder (for example
`implementations/fastify`), where the `ofl` CLI reads that variant's `.env`.

## 1. Worker stops between a side effect and the acknowledgement

- **Behavior:** the job row stays `PROCESSING` with a lease. When the lease
  (30 s) expires, any worker can claim it again. The payment gateway is called
  with the same idempotency key and returns the same provider event; the unique
  `payment_events.provider_event_id` makes the second recording a no-op.
  After `max_attempts`, an expired job moves to `FAILED` instead of looping.
- **Reproduce:** acceptance scenario S7 (`packages/test-contracts/src/scenarios/s07-worker-crash.ts`)
  injects a fault after the gateway call. By hand: start the worker, check out
  an order, and stop the worker with `kill -9` while it processes the job.
- **Recover:** start the worker again. No manual step is needed.
- **Code:** [`outbox/outbox.ts`](../packages/server-core/src/outbox/outbox.ts),
  [`payments/processing.ts`](../packages/server-core/src/features/payments/processing.ts),
  [`payments/gateway.ts`](../packages/server-core/src/features/payments/gateway.ts).

## 2. A job fails permanently

- **Behavior:** `classifyError` (domain) decides. Retryable errors (lost
  connection, deadlock, serialization failure, timeouts, HTTP 429/5xx) retry
  with exponential backoff and jitter (500 ms base, 60 s cap). Other errors, or
  running out of attempts, set `FAILED` with `last_error`.
- **Reproduce:** stop Elasticsearch (`pnpm infra:down`) and change a price in
  the admin dashboard. The `search.product_changed` job retries, then fails.
- **Inspect:** admin dashboard "Failed jobs", or `pnpm exec ofl jobs`.
- **Recover:** fix the cause, then press "Retry" in the dashboard (writes an
  audit row) or run `pnpm exec ofl retry-jobs --all-failed`.

## 3. Elasticsearch is unavailable

- **Behavior:** `searchProducts` and `productSuggestions` return the GraphQL
  error `SEARCH_UNAVAILABLE` after a short client timeout. The UI shows a
  recoverable message. Product detail, cart, checkout, orders, and dashboards
  read PostgreSQL only and keep working. Readiness stays OK (it depends on
  PostgreSQL) and reports Elasticsearch as down. Index updates wait in the outbox.
- **Reproduce:** `pnpm infra:down`, then use the catalog. Scenario S13 does
  the same with an unreachable URL.
- **Recover:** `pnpm infra:up`, then `pnpm exec ofl retry-jobs --all-failed`.
  If the index was lost, run `pnpm exec ofl reindex`.

## 4. The search index is stale or corrupted

- **Behavior:** search can show an old price or stock flag. Checkout is not
  affected: it rechecks price (`PriceChanged`) and stock (`InsufficientStock`)
  in PostgreSQL.
- **Recover:** `pnpm exec ofl reindex`. It builds a new index, writes current
  products, switches the alias atomically, and deletes the old index. Updates
  that arrive during the rebuild are written to both indexes; external
  versioning keeps the newest state.

## 5. PostgreSQL restarts or a connection drops

- **Behavior:** requests in flight fail with `INTERNAL_SERVER_ERROR` (masked;
  the log has the correlation ID). The pool opens new connections on the next
  request. In-request transactions retry deadlocks and serialization failures
  up to 3 times. Worker jobs classify connection loss as retryable. The realtime
  listener reconnects with backoff; subscribers miss notifications during the
  gap but receive the current state when they re-subscribe.
- **Reproduce:** `brew services restart postgresql@17` while the app runs
  (this is a system-level command; run it yourself).
- **Recover:** automatic. Run `pnpm exec ofl reconcile` to confirm that stock
  balances still match the ledger.

## 6. Duplicate or late payment notifications

- **Behavior:** a repeated `providerEventId` returns `{"status":"duplicate"}`
  with no side effects. A success that arrives after the reservation expired or
  after cancellation is captured and fully refunded (`LATE_PAYMENT`).
- **Reproduce:** S4 and S5, or post the same signed webhook twice
  (see [requirements.md §6.2](requirements.md#62-payment-simulated-provider)).

## 7. Reservations are never paid

- **Behavior:** the `reservation.expire` job runs at `expires_at` and releases
  the stock once. A sweeper in the worker re-enqueues expiry for any `ACTIVE`
  reservation past its time, in case a job was lost.
- **Inspect:** admin dashboard "Expired active reservations" should stay 0
  while a worker runs.

## 8. Ledger and balances disagree

- **Detection:** `pnpm exec ofl reconcile` compares every balance with the sum
  of its movements. On large data sets (the bench profile has 800,000
  movements) the full aggregation can exceed the default 5 s statement
  timeout; run it as `STATEMENT_TIMEOUT_MS=60000 pnpm exec ofl reconcile`. The acceptance suite runs the same check after each scenario.
- **Recovery:** this should not happen, because every balance change writes its
  movement in the same transaction. If it does, stop writes, find the first
  movement after the last good reconcile, and correct it with an `ADJUSTMENT`
  movement through the inventory screen (audited). Do not edit balances directly.

## 9. Graceful shutdown

- **Behavior:** on `SIGTERM` or `SIGINT`, each API stops accepting connections,
  finishes in-flight requests, closes WebSocket subscriptions, then closes the
  database pool, the LISTEN connection, and the search client. The worker stops
  claiming, finishes running jobs, then exits. A second signal, or a shutdown
  longer than the timeout, exits immediately; leases make interrupted jobs
  claimable again.

## 10. Several API and worker instances

- **Shared state:** all coordination goes through PostgreSQL: row locks for
  stock, unique keys for idempotency, `SKIP LOCKED` leases for jobs,
  `LISTEN/NOTIFY` for live updates. Any number of API and worker processes can
  run against one database.
- **Single-instance limits:** rate limits are in memory per process, so N
  instances allow N times the limit (a shared store such as Redis would fix
  this). Each process holds `DB_POOL_MAX + 1` connections; keep the total below
  PostgreSQL `max_connections`.
