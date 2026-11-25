import { pageRequest } from '../../db/pagination';
import { listAuditEntries } from '../../features/audit/queries';
import { requireAdmin } from '../../features/auth/guards';
import { updateSkuPrice } from '../../features/catalog/operations';
import { retryJob } from '../../features/operations/jobs';
import { countOrdersByStatus, dailyRevenue, jobHealth, listJobs, lowStock, type JobHealth } from '../../features/operations/queries';
import type { GraphQLContext } from '../context';
import type { OperationsSummaryModel } from '../models';
import type { Resolvers } from '../generated/resolvers';
import { loaders, money, required, typenameOf } from './common';

// The four job-health fields share one query per summary object.
const healthBySummary = new WeakMap<OperationsSummaryModel, Promise<JobHealth>>();

function health(summary: OperationsSummaryModel, ctx: GraphQLContext): Promise<JobHealth> {
  let pending = healthBySummary.get(summary);
  if (!pending) {
    pending = jobHealth(ctx.services.db, summary.now);
    healthBySummary.set(summary, pending);
  }
  return pending;
}

export const adminResolvers: Resolvers = {
  Query: {
    operationsSummary: (_parent, _args, ctx) => {
      requireAdmin(ctx.viewer);
      return { now: ctx.services.clock.now() };
    },
    jobs: (_parent, args, ctx) => {
      requireAdmin(ctx.viewer);
      return listJobs(ctx.services.db, args.status ?? 'FAILED', pageRequest(args.first, args.after));
    },
    auditLog: (_parent, args, ctx) => {
      requireAdmin(ctx.viewer);
      return listAuditEntries(ctx.services.db, pageRequest(args.first, args.after));
    },
  },
  Mutation: {
    updateSkuPrice: async (_parent, args, ctx) => ({
      __typename: 'SkuPriceUpdated',
      sku: await updateSkuPrice(ctx.services, ctx.viewer, args.input, ctx.meta),
    }),
    retryJob: async (_parent, args, ctx) => {
      const outcome = await retryJob(ctx.services, ctx.viewer, args.jobId, ctx.meta);
      if (outcome.kind === 'retried') return { __typename: 'JobRetried', job: outcome.job };
      return { __typename: 'JobNotRetryable', code: 'JOB_NOT_RETRYABLE', message: 'Only failed jobs can be retried.', status: outcome.status };
    },
  },
  UpdateSkuPriceResult: { __resolveType: (parent) => typenameOf(parent) },
  RetryJobResult: { __resolveType: (parent) => typenameOf(parent) },
  OperationsSummary: {
    ordersByStatus: (_summary, _args, ctx) => countOrdersByStatus(ctx.services.db),
    dailyRevenue: async (summary, args, ctx) =>
      (await dailyRevenue(ctx.services.db, args.days ?? 14, summary.now)).map((row) => ({
        day: row.day,
        orders: row.orders,
        revenue: money(row.revenueMinor),
        cumulativeRevenue: money(row.cumulativeRevenueMinor),
      })),
    lowStock: (_summary, args, ctx) => lowStock(ctx.services.db, args.threshold ?? 5, args.limit ?? 20),
    pendingJobs: async (summary, _args, ctx) => (await health(summary, ctx)).pendingJobs,
    failedJobs: async (summary, _args, ctx) => (await health(summary, ctx)).failedJobs,
    oldestPendingJobAgeSeconds: async (summary, _args, ctx) => (await health(summary, ctx)).oldestPendingJobAgeSeconds,
    expiredActiveReservations: async (summary, _args, ctx) => (await health(summary, ctx)).expiredActiveReservations,
  },
  LowStockItem: {
    sku: async (item, _args, ctx) => required(await loaders(ctx).sku.load(item.skuId), 'SKU'),
    warehouse: async (item, _args, ctx) => required(await loaders(ctx).warehouse.load(item.warehouseId), 'Warehouse'),
  },
  Job: {
    aggregateType: (job) => job.aggregate_type,
    aggregateId: (job) => job.aggregate_id,
    maxAttempts: (job) => job.max_attempts,
    lastError: (job) => job.last_error,
    availableAt: (job) => job.available_at.toISOString(),
    createdAt: (job) => job.created_at.toISOString(),
  },
  AuditEntry: {
    actor: (entry, _args, ctx) => (entry.actorUserId ? loaders(ctx).user.load(entry.actorUserId) : null),
    details: (entry) => JSON.stringify(entry.details ?? {}),
  },
};
