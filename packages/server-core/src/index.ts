// Public API of @ofl/server-core (docs/architecture.md §3). Framework code
// imports only from here.

// Configuration and process services
export { loadConfig, type AppConfig } from './config';
export { createServices, closeServices, type Services, type ServiceRole, type CreateServicesOptions } from './services';
export { systemClock, createManualClock, createOffsetClock, type Clock, type ManualClock } from './clock';

// Observability
export { correlationIdFrom, CORRELATION_HEADER } from './observability/correlation';
export { createLogger, type Logger } from './observability/logger';
export type { Metrics, HttpObservation } from './observability/metrics';

// Authentication
export {
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  login,
  logout,
  resolveSession,
  type SessionUser,
  type RequestMeta,
  type LoginResult,
} from './features/auth/sessions';
export { hashPassword } from './features/auth/passwords';

// GraphQL
export { buildGraphQLSchema } from './graphql/schema';
export { createGraphQLContext, type GraphQLContext, type CreateContextOptions } from './graphql/context';
export { graphqlYogaPlugins, QUERY_COUNT_HEADER } from './graphql/plugins';
export { executeOperation, type TypedDocument } from './graphql/execute';
export { graphqlWsServerOptions } from './graphql/ws';
export { MAX_COST, MAX_DEPTH } from './graphql/limits';

// Payments
export {
  handlePaymentWebhook,
  signWebhookBody,
  recordPaymentNotification,
  type PaymentNotification,
  type WebhookResponse,
} from './features/payments/notifications';
export { expireOrderReservations } from './features/orders/operations';

// Health
export { checkLiveness, checkReadiness, type Readiness, type DependencyCheck } from './health';

// Worker
export {
  startWorker,
  runWorkerUntilIdle,
  type WorkerFaults,
  type WorkerJobInfo,
  type WorkerHandle,
  type WorkerOptions,
  type RunUntilIdleOptions,
} from './worker/worker';

// Operations
export { migrate, resetDatabase, truncateAllData, assertResettable, type MigrationReport } from './db/migrate';
export { createDb, type Db, type Tx, type Queryable } from './db/db';
export { rebuildSearchIndex, reconcileLedger } from './features/operations/maintenance';
export type { LedgerDifference } from './features/inventory/queries';
