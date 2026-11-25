# ADR 0007: PostgreSQL LISTEN/NOTIFY as the cross-process live hint

## Status
Accepted.

## Context
A client subscribed on API process 1 must see a change committed by API
process 2 or by the worker.

## Decision
Every order change calls `pg_notify('order_events', orderId)` in its
transaction. Each process keeps one `LISTEN` connection and re-reads the order
from PostgreSQL before it sends an event.

## Reasons
- No extra infrastructure; NOTIFY is delivered only on commit.
- The notification is a hint. State always comes from PostgreSQL, so a lost
  or duplicated notification cannot show wrong data.

## Consequences
- Notifications sent while a listener is disconnected are lost. The client
  re-subscribes and the server sends the current order on subscribe.
- One LISTEN connection per process. Beyond a few hundred processes, or for
  replay requirements, a broker (for example Redis Streams or NATS) fits better.
