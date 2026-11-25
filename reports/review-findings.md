# Independent review: findings and resolution

The review agent did not write any of the code. It read the code, ran every
suite, and attacked running servers on a separate database (`ofl_review`).
Full reports with reproduction steps:
[`review-pass-1.md`](review-pass-1.md) (shared packages, Fastify) and
[`review-pass-2.md`](review-pass-2.md) (Express, Next.js, SPA, finished server-core).

## What held up under attack

- 60 concurrent checkouts on overlapping SKUs in different line orders: no deadlock, no oversell.
- One idempotency key reused with different payloads: exactly one order.
- Three concurrent returns over the shipped quantity: one accepted, two `ReturnQuantityExceeded`.
- Cancel vs ship, payment vs cancel, payment vs expiry: no inconsistent outcome.
- Another customer's order: `NOT_FOUND` through queries, mutations, nested fields, and subscriptions.
- CSRF header, body limits (Fastify, Next.js), depth limit, webhook signature over raw bytes, WebSocket Origin check, production cookie flags (`HttpOnly; Secure; SameSite=Lax`).
- No emails or session tokens in logs. Redux holds no server data.
- The ledger reconciled with zero differences after every attack.

## Findings

| ID | Severity | Finding | Fix | Verified by |
| --- | --- | --- | --- | --- |
| F1 / P2-2 | High | Cost limit bypass: about 2,400 aliased `searchProducts` fit under 5000, without sign-in; 300 aliases overloaded search | Root fields cost at least 10, aliases counted separately, max 20 root fields per operation; checked for HTTP, in-process, and WebSocket | server-core regression tests (300 aliases rejected before any resolver runs) |
| P2-1 | High | Next.js rate limiter keyed on client-supplied `X-Forwarded-For`; rotating the header avoided the login limit | `TRUST_PROXY` setting (default off); right-most entry only behind a trusted proxy; otherwise one bucket per route; plus a per-account login limit | Next.js route-handler tests (rotating header still gets 429) |
| F2 | Medium | A job that crashes the worker was reclaimed forever (attempts 11 > max 8) | Expired leases at max attempts move to `FAILED` | server-core worker test (8 crashes → FAILED) |
| F3 / P2-4 | Medium | An open WebSocket kept its identity after logout, and queries over it bypassed the HTTP rate limit | WebSocket serves subscriptions only; session re-resolved on every subscribe and checked before each event | server-core realtime test (logout ends the stream; query/mutation over WS rejected) |
| F4 | Medium | Lost PostgreSQL connections (`57P01`, "Connection terminated") classified as permanent | Added connection-loss SQLSTATEs and node-postgres messages as retryable | domain unit tests |
| P2-3 | Medium | Express parsed only `application/json`; `application/graphql+json` bodies up to 16 MB were accepted | 100 KB limit for all JSON types; other non-empty bodies get 415 | Express API tests and live probe (1 MB and 16 MB → 413) |
| P2-5 | Low-medium | Next.js price Server Action parsed money with floating point | Strict decimal-string parser to integer cents | 23 unit tests |
| Low | Low | Forged search cursor and non-UUID ID arguments returned `INTERNAL_SERVER_ERROR` | `BAD_USER_INPUT` | server-core tests |
| Low | Low | Fastify validated webhook body before the signature, leaking schema details to unsigned callers | Signature check first (401), then parse and validate | Fastify HTTP test |
| Low | Low | Readiness returned raw driver error messages | Short code `unreachable`; detail in the log | server-core test |
| Low | Low | `allowedActions` rules lived in a resolver; state machines were defined but not enforced | `orderAllowedActions` in `@ofl/domain`; `assertTransition` on every status change | domain and server-core tests |
| Low | Low | Next.js realtime and worker health listened on all interfaces | Bind to `127.0.0.1` by default (`HOST` overrides) | code review |
| Low | Low | `scripts/bench/explain-my-orders.ts` could drop indexes on any database | Refuses any database except `ofl_bench`; always restores indexes | manual run against `ofl_review` (refused) |
| F5 | Low | `test-fixtures` lint and test failed on an empty `tests/` folder | Already resolved when re-checked: 5/5 tests, lint clean | coordinator re-run |

## Accepted, documented, not changed

| Item | Reason |
| --- | --- |
| `/metrics` endpoints are not authenticated | Intended for an internal network; documented in each variant README and in `docs/failure-scenarios.md`. |
| Rate limits are per process | Documented single-instance limit; a shared store is exercise 2 in `docs/interview-guide.md`. |
| `Sku.stock` shows on-hand and reserved to anonymous users | Catalog stock data, no customer data. Restricting it would need a schema change; recorded as a known trade-off. |
| Every indexing job takes a shared row lock on `search_index_state` | Needed so that a rebuild cannot delete an index that a write is using; measured worker throughput is in `benchmarks.md`. |
| S13 accepts `FAILED` as well as `PENDING` for the search job | The scenario allows both: what matters is that the event is not lost and checkout is correct. |
| Next.js Server Action Origin check, browser and screen-reader testing, real PostgreSQL restart | Not verified by the reviewer; listed as unverified. |
