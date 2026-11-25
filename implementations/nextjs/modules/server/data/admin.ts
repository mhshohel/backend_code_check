import 'server-only';
import {
  AuditLogDocument,
  JobsDocument,
  OperationsSummaryDocument,
  type AuditLogQuery,
  type JobStatus,
  type JobsQuery,
  type OperationsSummaryQuery,
} from '@ofl/graphql-types';
import { queryAsViewer } from './execute';

export const ADMIN_PAGE_SIZE = 25;
export const REVENUE_DAYS = 14;
export const LOW_STOCK_THRESHOLD = 5;

export async function loadOperationsSummary(): Promise<OperationsSummaryQuery['operationsSummary']> {
  const result = await queryAsViewer(
    OperationsSummaryDocument,
    { days: REVENUE_DAYS, threshold: LOW_STOCK_THRESHOLD },
    { returnTo: '/admin' },
  );
  return result.operationsSummary;
}

export async function loadJobs(status: JobStatus, after: string | null): Promise<JobsQuery['jobs']> {
  const result = await queryAsViewer(JobsDocument, { status, first: ADMIN_PAGE_SIZE, after }, { returnTo: '/admin/jobs' });
  return result.jobs;
}

export async function loadAuditLog(after: string | null): Promise<AuditLogQuery['auditLog']> {
  const result = await queryAsViewer(AuditLogDocument, { first: ADMIN_PAGE_SIZE, after }, { returnTo: '/admin/audit' });
  return result.auditLog;
}
