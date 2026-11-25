# ADR 0005: Shared application layer, framework-specific transport

## Status
Accepted.

## Context
The project must not duplicate large business modules across variants, but the
framework differences must stay visible.

## Decision
`@ofl/server-core` holds business operations, SQL, the GraphQL schema and
resolvers, the outbox worker engine, search, and realtime. Each variant owns
HTTP routing, middleware or hooks, cookie handling, CSRF checks, rate limits,
WebSocket hosting, error responses, health endpoints, graceful shutdown, and
rendering.

## Consequences
- A business fix is made once and applies to all variants.
- The acceptance suite runs against each variant over HTTP, so a transport
  mistake in one variant still fails its tests.
- Resolvers are shared. A variant cannot change the GraphQL behavior without
  changing the shared layer, which is the intent: the contract is the same.
