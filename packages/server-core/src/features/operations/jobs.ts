import { notFound } from '@ofl/domain';
import type { Services } from '../../services';
import { retryFailedJob, type JobRow, type JobStatus } from '../../outbox/outbox';
import { writeAudit } from '../audit/audit';
import { requireAdmin } from '../auth/guards';
import type { RequestMeta, SessionUser } from '../auth/sessions';

export type RetryJobOutcome = { kind: 'retried'; job: JobRow } | { kind: 'not_retryable'; status: JobStatus };

/** Administrator. FAILED -> PENDING with a fresh attempt budget, audited. */
export async function retryJob(services: Services, viewer: SessionUser | null, jobIdInput: string, meta: RequestMeta): Promise<RetryJobOutcome> {
  const admin = requireAdmin(viewer);
  if (!/^\d{1,18}$/.test(jobIdInput)) throw notFound('Job');
  return retryJobAs(services, admin.id, jobIdInput, meta);
}

/** Shared by the GraphQL mutation and the CLI (actor null = operator shell). */
export async function retryJobAs(services: Services, actorUserId: string | null, jobId: string, meta: RequestMeta): Promise<RetryJobOutcome> {
  return services.db.transaction(async (tx) => {
    const outcome = await retryFailedJob(tx, jobId, services.clock.now());
    if (outcome.kind === 'not_found') throw notFound('Job');
    if (outcome.kind === 'retried') {
      await writeAudit(tx, {
        actorUserId,
        action: 'job.retried',
        entityType: 'outbox_event',
        entityId: jobId,
        details: { topic: outcome.job.topic, aggregateId: outcome.job.aggregate_id, via: actorUserId ? 'graphql' : 'cli' },
        correlationId: meta.correlationId,
      });
    }
    return outcome;
  });
}

/** CLI: retries every FAILED job. Returns the number of jobs moved back to PENDING. */
export async function retryAllFailedJobs(services: Services, meta: RequestMeta): Promise<number> {
  const failed = await services.db.query<{ id: string }>(`SELECT id::text AS id FROM outbox_events WHERE status = 'FAILED' ORDER BY id`);
  let retried = 0;
  for (const row of failed.rows) {
    const outcome = await retryJobAs(services, null, row.id, meta);
    if (outcome.kind === 'retried') retried += 1;
  }
  return retried;
}
