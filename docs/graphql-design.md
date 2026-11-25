# GraphQL design

The contract is [`contracts/schema.graphql`](../contracts/schema.graphql). All
three variants serve it unchanged from the shared resolvers in
`packages/server-core/src/graphql/`.

## 1. Why GraphQL for business operations

- One typed contract for three different servers and two different UIs.
- Generated TypeScript types for the server (resolver signatures) and the
  clients (typed documents), so a schema change breaks the build instead of
  production.
- Clients ask for the nested order data they show (lines, reservations,
  shipments, returns) in one round trip.

The cost of that flexibility is the N+1 problem and unbounded queries. Sections
4 and 5 explain the controls.

## 2. Error model

Two kinds of failures, handled differently:

| Kind | Example | Shape | Client handling |
| --- | --- | --- | --- |
| Expected business outcome | Not enough stock | Union member implementing `DomainError` | `switch (result.__typename)` |
| Cross-cutting failure | Not signed in, bad input, search down | GraphQL error with `extensions.code` | Generic handler |

```graphql
mutation {
  checkout(input: { idempotencyKey: "2b7c...", paymentToken: "tok_approve",
                    lines: [{ skuId: "...", quantity: 2, expectedUnitPriceMinor: 2499 }] }) {
    __typename
    ... on CheckoutSucceeded { replayed order { id number status } }
    ... on InsufficientStock { message lines { skuId requested available } }
    ... on PriceChanged { message lines { skuId currentUnitPrice { formatted } } }
    ... on IdempotencyKeyReused { message }
  }
}
```

Why unions for business outcomes: the client must handle them, so they belong
in the type system. A thrown error would hide them among network failures.

Error codes: `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `BAD_USER_INPUT`
(with `extensions.fieldErrors: [{ path, message }]`), `QUERY_TOO_COMPLEX`,
`SEARCH_UNAVAILABLE`, `RATE_LIMITED`, `INTERNAL_SERVER_ERROR`. Unexpected
errors are masked: the client sees only the code and the correlation ID; the
log has the details.

## 3. Pagination

All lists that can grow use cursor connections (`edges { cursor node }`,
`pageInfo { hasNextPage endCursor }`).

| Connection | Sort key | Tie-breaker | Max `first` |
| --- | --- | --- | --- |
| `myOrders`, `orders` | `created_at DESC` | `id DESC` | 50 |
| `inventory` | `sku code, warehouse code` | composite key | 50 |
| `inventoryMovements`, `jobs`, `auditLog` | `id DESC` | (id is unique) | 50 |
| `searchProducts` | score or price or date | product id (Elasticsearch `search_after`) | 50 |

Cursors are opaque base64url strings. A tampered cursor returns `BAD_USER_INPUT`.

## 4. N+1 prevention with DataLoader

Without batching, a page of 50 orders with lines, reservations, and payments
would run 1 + 50 × 3 queries. Each request gets fresh DataLoader instances
created in `createGraphQLContext`, so:

- all `Order.lines` requests in one tick become one
  `WHERE order_id = ANY($1)` query;
- caches never leak between users or requests (a shared cache would show one
  customer's data to another and would serve stale state).

Acceptance scenario S12 checks that the query count is the same for 5, 20, and
50 orders. Measured counts are in [testing.md](testing.md).

## 5. Query limits

| Limit | Value | Why |
| --- | --- | --- |
| Depth | 10 | The deepest real operation (`orderUpdated` → order → returns → lines → warehouse) is 6. |
| Cost | 5000 | See the cost model below. The full `OperatorOrders(first: 50)` page stays under the limit; nested connections of connections exceed it. |
| Root fields | 20 per operation | Counted after fragments are expanded; every alias counts. Stops one request from fanning out into hundreds of searches. |
| Page size | 1..50 | Enforced in resolvers with `BAD_USER_INPUT`. |
| Body size | 100 KB | Enforced by each HTTP framework. |

Cost model ([`graphql/limits.ts`](../packages/server-core/src/graphql/limits.ts)):

| Field | Cost |
| --- | --- |
| Root field (each alias separately) | at least 10, plus its subtree |
| Field with `first` or `limit` | 10 + size × subtree (size defaults to 20) |
| `edges` inside a connection | not multiplied again |
| Other list field | 5 × subtree |
| Other object field | 1 + subtree |
| Scalar field | 0 |

Why a base cost for root fields: an earlier model charged 1 for a field with
only scalar children. The independent review sent 300 aliased
`searchProducts` fields in one anonymous request; they fit under the limit and
overloaded Elasticsearch. Root fields now cost at least 10, and an operation
may have at most 20 root fields.

The limits run in three places: the Yoga plugin (HTTP), `executeOperation`
(Next.js Server Components), and the WebSocket subscribe handler. A rejected
query returns `QUERY_TOO_COMPLEX` before any resolver runs.

WebSocket accepts only subscriptions. Queries and mutations sent over a socket
are rejected, so they cannot bypass the HTTP rate limits.

## 6. Authorization

1. The framework resolves the session and passes `viewer` to the context.
2. Resolvers call helpers such as `requireRole(ctx, 'OPERATOR', 'ADMIN')`.
3. Object-level checks run in the operation: a customer can only load orders
   with `customer_id = viewer.id`. Others get `NOT_FOUND`.
4. `allowedActions` is computed on the server, so the UI never decides
   eligibility.

## 7. Subscriptions

`orderUpdated(orderId)` uses the `graphql-ws` protocol. See
[requirements.md §9](requirements.md#9-real-time-order-updates) and
[ADR 0007](decisions/0007-realtime-through-postgres-notify.md).

Reconnect path:

1. The client's `graphql-ws` client retries with backoff after a disconnect.
2. On reconnect it sends `subscribe` again.
3. The server immediately sends the current order from PostgreSQL.
4. Changes that happened while disconnected are therefore visible, but as one
   current state, not as a replay of each intermediate event.

## 8. Code generation

```
contracts/schema.graphql ─┬─> server-core/src/graphql/generated/resolvers.ts   (resolver signatures, mappers)
contracts/operations/*  ──┴─> graphql-types/src/generated/operations.ts         (typed documents, result types)
```

Run `pnpm codegen` after any change to the schema or operations.
