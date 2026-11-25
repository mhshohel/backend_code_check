# ADR 0009: Root-field cost and subscriptions-only WebSocket

## Status
Accepted after the independent review (findings F1, F3, P2-4 in
[`reports/review-findings.md`](../../reports/review-findings.md)).

## Context
Two gaps were found by attacking running servers:

1. The cost model charged 1 for a field with only scalar children. One
   anonymous request with 300 aliased `searchProducts` fields stayed under the
   limit of 5000 and overloaded Elasticsearch.
2. The WebSocket connection accepted queries and mutations, which bypassed the
   HTTP rate limits, and it kept the identity of the session it opened with,
   even after logout.

## Decision
1. Every root field costs at least 10, each alias separately. Fields with
   `first`/`limit` cost 10 + size × subtree. An operation may have at most 20
   root fields. The check runs for HTTP (Yoga plugin), in-process calls
   (`executeOperation`), and WebSocket subscribe.
2. WebSocket serves only `subscription` operations. The session is resolved
   again on every subscribe and checked before each emitted event; a revoked or
   expired session completes the stream.

## Alternatives considered
- Per-field cost annotations in the schema (directives): more precise, but adds
  schema noise for a small API. Rejected for now.
- Closing the socket on logout by pushing a message from the logout handler:
  needs a cross-process signal for every session. Checking before each event
  achieves the same result with no extra channel.

## Consequences
- Search cursors changed format (`[sortMode, value, id]`); old cursors return
  `BAD_USER_INPUT`.
- After logout, an open subscription ends at the next order event, not
  immediately. No data is sent after the session ends.
- Clients must send queries and mutations over HTTP. Both UIs already did:
  urql's `subscriptionExchange` forwards subscriptions only.
