# ADR 0002: One PostgreSQL table for the outbox and the job queue

## Status
Accepted.

## Context
Business changes must trigger side effects (payment, refund, search indexing,
expiry). Writing to an external system inside the request transaction can
leave the two systems inconsistent when one side fails.

## Decision
Write an `outbox_events` row in the same transaction as the business change.
The worker claims rows with `FOR UPDATE SKIP LOCKED`, sets a lease, and runs
the handler for the topic. No message broker.

## Reasons
- Atomic: the event exists if and only if the business change committed.
- Simple to operate: one database, visible with SQL, easy to retry.
- `SKIP LOCKED` lets several workers claim different rows without blocking.
- A lease (`lease_expires_at`) makes jobs from a crashed worker claimable again.

## Consequences
- Delivery is at least once. Every handler must be idempotent.
- Throughput is bounded by PostgreSQL. A partial index on unfinished rows keeps
  the claim query cheap. A broker becomes useful when consumers need fan-out to
  many independent services or throughput above what one primary can absorb.
- `DONE` rows accumulate. A retention job (delete DONE rows older than N days) is
  an exercise in `docs/interview-guide.md`.
