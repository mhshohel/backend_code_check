# Architecture

## 1. Overview

```mermaid
flowchart LR
  subgraph Browser
    SPA[React SPA<br/>Express / Fastify]
    NX[Next.js pages<br/>RSC + client components]
  end
  subgraph Variant process
    API[HTTP server<br/>Express / Fastify / Next.js route handlers]
    WS[graphql-ws server]
    CORE[@ofl/server-core<br/>application layer]
  end
  W[Worker process]
  PG[(PostgreSQL<br/>source of truth)]
  ES[(Elasticsearch<br/>derived search index)]
  SPA -- GraphQL HTTP + cookie --> API
  SPA -- graphql-ws --> WS
  NX -- server-side call, no HTTP --> CORE
  NX -- GraphQL HTTP for mutations --> API
  API --> CORE
  WS --> CORE
  CORE -- transactions, outbox insert, pg_notify --> PG
  CORE -- search queries --> ES
  W -- claim jobs SKIP LOCKED --> PG
  W -- index documents --> ES
  PG -- LISTEN order_events --> WS
```

Each variant has its own HTTP process, worker process, database, and index
prefix. They share code, not data.

## 2. Package boundaries

| Package | Owner | Contains | Must not contain |
| --- | --- | --- | --- |
| `@ofl/domain` | coordinator | Pure rules: money, allocation, state machines, eligibility, validation, retry classification, cursors. | I/O, SQL, framework objects. |
| `@ofl/graphql-types` | coordinator | Generated operation types and typed documents. | Hand-written types. |
| `@ofl/server-core` | core agent | Application layer: config, DB access, business operations per feature, outbox and worker engine, search, realtime, auth sessions, GraphQL schema + resolvers + loaders, observability, CLI. | Express/Fastify/Next objects. |
| `@ofl/test-fixtures` | core agent | Deterministic seed data (demo, contract, bench profiles). | Test assertions. |
| `@ofl/test-contracts` | Fastify agent | The 14 acceptance scenarios as a reusable Jest suite parameterized by target. | Implementation-specific code. |
| `@ofl/web-spa` | Express agent | The React SPA (React Router, Redux Toolkit, urql) shared by the Express and Fastify variants. | Business rules. |
| `implementations/express` | Express agent | Express HTTP server, security middleware, Yoga mount, WebSocket server, webhook, health, worker entry, SPA entry, tests. | Business rules. |
| `implementations/fastify` | Fastify agent | Same, with Fastify plugins, hooks, and lifecycle. | Business rules. |
| `implementations/nextjs` | Next.js agent | App Router pages, layouts, loading/error boundaries, route handlers, server actions, realtime service, worker entry, tests. | Business rules. |

Why the SPA is shared: the Express and Fastify variants differ in the server,
not in the browser. Their browser code would be identical, so one package
avoids two copies drifting apart. Each variant still has its own `web/` entry
(Vite config, dev proxy, base URLs). See ADR 0004.

Layering inside `@ofl/server-core`, per feature folder
(`src/features/<feature>/`):

```
GraphQL resolver  ->  operation (business workflow, transaction)  ->  queries (SQL)
   thin mapping         uses @ofl/domain rules                        parameterized
```

Resolvers only check authentication shape, parse input, call one operation,
and map the result. They never contain business rules.

## 3. `@ofl/server-core` public API

Framework code may import only from `@ofl/server-core` (the package index).
Signatures below are the contract. Types are exported from the index.

```ts
// Configuration (zod-validated environment)
type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  databaseUrl: string; dbPoolMax: number; statementTimeoutMs: number;
  elasticsearchUrl: string; esIndexPrefix: string;
  reservationTtlSeconds: number; sessionTtlSeconds: number;
  paymentWebhookSecret: string; enableQueryCount: boolean; logLevel: string;
};
function loadConfig(env?: Record<string, string | undefined>): AppConfig;

// Long-lived services for one process
type Services = { config: AppConfig; db: Db; search: SearchService; realtime: RealtimeHub;
                  logger: Logger; metrics: Metrics; clock: Clock };
function createServices(config: AppConfig, options?: { logger?: Logger; clock?: Clock; role?: 'api' | 'worker' | 'cli' }): Promise<Services>;
function closeServices(services: Services): Promise<void>;

// Correlation IDs
function correlationIdFrom(incoming: string | null | undefined): string; // validates or generates

// Authentication (frameworks own cookie reading/writing)
const SESSION_COOKIE_NAME = 'ofl_session';
function sessionCookieOptions(config: AppConfig): { httpOnly: true; sameSite: 'lax'; secure: boolean; path: '/'; maxAgeSeconds: number };
type SessionUser = { id: string; email: string; displayName: string; role: 'CUSTOMER' | 'OPERATOR' | 'ADMIN' };
function login(services: Services, input: unknown, meta: RequestMeta):
  Promise<{ kind: 'ok'; token: string; user: SessionUser; expiresAt: Date } | { kind: 'invalid' }>;
function logout(services: Services, token: string | undefined): Promise<void>;
function resolveSession(services: Services, token: string | undefined): Promise<SessionUser | null>;
type RequestMeta = { correlationId: string; ip?: string };

// GraphQL
function buildGraphQLSchema(services: Services): GraphQLSchema; // executable, includes subscriptions
function createGraphQLContext(services: Services, viewer: SessionUser | null, meta: RequestMeta,
  options?: { countQueries?: boolean }): GraphQLContext;   // fresh DataLoaders per request
function graphqlYogaPlugins(services: Services): Plugin[]; // depth/cost limits, error masking, metrics, queryCount extension
function executeOperation<TResult, TVariables>(services: Services, viewer: SessionUser | null, meta: RequestMeta,
  document: TypedDocumentNode<TResult, TVariables>, variables: TVariables): Promise<TResult>; // in-process, throws AppError
function graphqlWsServerOptions(services: Services, schema: GraphQLSchema,
  authenticate: (request: IncomingMessage) => Promise<SessionUser | null>): ServerOptions; // for graphql-ws useServer

// Payment webhook
function handlePaymentWebhook(services: Services, rawBody: string, signatureHeader: string | undefined, meta: RequestMeta):
  Promise<{ status: 200 | 400 | 401; body: { status: 'processed' | 'duplicate' } | { error: string } }>;
function signWebhookBody(rawBody: string, secret: string): string; // for tests and the simulator

// Health and metrics
function checkLiveness(): { ok: true };
function checkReadiness(services: Services): Promise<{ ok: boolean; checks: Record<'postgres' | 'elasticsearch', { ok: boolean; latencyMs: number; error?: string }> }>;
// services.metrics.observeHttp({ method, route, status, durationMs }); services.metrics.render(): Promise<string> (Prometheus text)

// Worker
function startWorker(services: Services, options: { workerId: string; concurrency?: number; pollIntervalMs?: number }):
  { stop(): Promise<void> }; // stop() finishes in-flight jobs, then resolves
function runWorkerUntilIdle(services: Services, options?: { workerId?: string; maxJobs?: number }): Promise<number>;

// Operations (also exposed through the `ofl` CLI: migrate | reset | seed | reindex | retry-jobs | reconcile)
function migrate(config: AppConfig): Promise<void>;
function resetDatabase(config: AppConfig): Promise<void>;
function rebuildSearchIndex(services: Services): Promise<{ index: string; documents: number }>;
function reconcileLedger(services: Services): Promise<{ differences: Array<{ skuId: string; warehouseId: string; field: string; balance: number; ledger: number }> }>;
```

The `ofl` CLI reads the environment of the current working directory's
`.env` file (`process.loadEnvFile`) so each variant runs it with its own
database and index prefix: `cd implementations/express && pnpm seed`.

## 4. Request flow (Express example)

1. `correlationId` middleware sets `x-correlation-id`.
2. Security middleware: Helmet headers, CORS allowlist, body limit, rate limit.
3. Session middleware reads `ofl_session`, calls `resolveSession`.
4. CSRF check for state-changing requests (`x-ofl-csrf: 1`).
5. Yoga handles `/graphql` with `createGraphQLContext(services, viewer, meta)`.
6. Resolver calls one operation in `@ofl/server-core`.
7. The operation runs one transaction, writes business rows, the outbox event,
   and `pg_notify`. Commit makes all of them visible at once.
8. The worker claims the outbox event and performs the side effect.

Fastify and Next.js follow the same steps with their own mechanisms
(hooks/plugins, route handlers/server actions). See each variant's README.
