# Architecture decision records

| ADR | Decision |
| --- | --- |
| [0001](0001-postgresql-row-locks-for-reservations.md) | Row locks in READ COMMITTED for stock reservations |
| [0002](0002-outbox-as-job-queue.md) | One PostgreSQL table for the outbox and the job queue |
| [0003](0003-search-versioning.md) | External versions computed from PostgreSQL counters |
| [0004](0004-shared-spa-for-express-and-fastify.md) | One React SPA package for Express and Fastify |
| [0005](0005-shared-application-layer.md) | Shared application layer, framework-specific transport |
| [0006](0006-sessions-and-csrf.md) | Server-side sessions with a custom CSRF header |
| [0007](0007-realtime-through-postgres-notify.md) | PostgreSQL LISTEN/NOTIFY as the cross-process live hint |
| [0008](0008-tooling-versions.md) | Tooling and package versions |
| [0009](0009-graphql-cost-and-websocket-scope.md) | Root-field cost and subscriptions-only WebSocket |
