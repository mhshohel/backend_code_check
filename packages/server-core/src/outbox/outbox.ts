import { backoffDelayMs } from '@ofl/domain';
import type { Queryable, Tx } from '../db/db';

export const OUTBOX_TOPICS = [
  'payment.authorize',
  'reservation.expire',
  'refund.process',
  'search.product_changed',
  'order.changed',
] as const;
export type OutboxTopic = (typeof OUTBOX_TOPICS)[number];

export const JOB_STATUSES = ['PENDING', 'PROCESSING', 'DONE', 'FAILED'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const LEASE_MS = 30_000;
export const MAX_ATTEMPTS = 8;
const BACKOFF = { baseMs: 500, maxMs: 60_000 };

export type OutboxEventInput = {
  topic: OutboxTopic;
  aggregateType: string;
  aggregateId: string;
  payload?: Record<string, unknown>;
  /** When the job becomes claimable. Defaults to the transaction's now(). */
  availableAt?: Date;
  correlationId?: string | null;
};

export type JobRow = {
  id: string;
  topic: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  available_at: Date;
  locked_by: string | null;
  lease_expires_at: Date | null;
  last_error: string | null;
  correlation_id: string | null;
  created_at: Date;
  processed_at: Date | null;
};

// bigint ids are returned as text so that callers never depend on numeric size.
export function jobColumns(alias = 'outbox_events'): string {
  return ['id::text AS id', 'topic', 'aggregate_type', 'aggregate_id', 'payload', 'status', 'attempts', 'max_attempts',
    'available_at', 'locked_by', 'lease_expires_at', 'last_error', 'correlation_id', 'created_at', 'processed_at']
    .map((column) => `${alias}.${column}`)
    .join(', ');
}

/** Writes events in the caller's transaction: they commit or roll back with the business change. */
export async function enqueueEvents(tx: Tx, events: readonly OutboxEventInput[]): Promise<void> {
  if (events.length === 0) return;
  await tx.query(
    `INSERT INTO outbox_events (topic, aggregate_type, aggregate_id, payload, available_at, correlation_id)
     SELECT e.topic, e.aggregate_type, e.aggregate_id, e.payload, COALESCE(e.available_at, now()), e.correlation_id
     FROM jsonb_to_recordset($1::jsonb) AS e(topic text, aggregate_type text, aggregate_id text, payload jsonb,
                                             available_at timestamptz, correlation_id text)`,
    [
      JSON.stringify(
        events.map((event) => ({
          topic: event.topic,
          aggregate_type: event.aggregateType,
          aggregate_id: event.aggregateId,
          payload: event.payload ?? {},
          available_at: event.availableAt?.toISOString() ?? null,
          correlation_id: event.correlationId ?? null,
        })),
      ),
    ],
  );
}

export type ClaimOptions = { workerId: string; limit: number; now: Date; leaseMs?: number; jobIds?: readonly string[] };

export const LEASE_EXHAUSTED_ERROR = 'lease expired after max attempts';

/**
 * Claims up to `limit` jobs. SKIP LOCKED lets concurrent workers pass over
 * rows another worker is claiming, so a job is never claimed twice at once.
 * A PROCESSING row whose lease has expired belongs to a crashed worker and
 * is claimable again; `attempts` counts every claim. A crashed job that has
 * used all its attempts goes to FAILED instead: a payload that kills the
 * worker process must not be retried forever.
 */
export async function claimJobs(db: Queryable, options: ClaimOptions): Promise<JobRow[]> {
  const leaseUntil = new Date(options.now.getTime() + (options.leaseMs ?? LEASE_MS));
  const jobIds = options.jobIds ? [...options.jobIds] : null;
  await db.query(
    `UPDATE outbox_events
     SET status = 'FAILED', last_error = $2, locked_by = NULL, lease_expires_at = NULL
     WHERE id IN (
       SELECT id FROM outbox_events
       WHERE status = 'PROCESSING' AND lease_expires_at < $1 AND attempts >= max_attempts
         AND ($3::bigint[] IS NULL OR id = ANY($3::bigint[]))
       FOR UPDATE SKIP LOCKED
     )`,
    [options.now, LEASE_EXHAUSTED_ERROR, jobIds],
  );
  const result = await db.query<JobRow>(
    `WITH next AS (
       SELECT id FROM outbox_events
       WHERE ((status = 'PENDING' AND available_at <= $1)
              OR (status = 'PROCESSING' AND lease_expires_at < $1 AND attempts < max_attempts))
         AND ($5::bigint[] IS NULL OR id = ANY($5::bigint[]))
       ORDER BY available_at, id
       LIMIT $2
       FOR UPDATE SKIP LOCKED
     )
     UPDATE outbox_events o
     SET status = 'PROCESSING', attempts = o.attempts + 1, locked_by = $3, lease_expires_at = $4
     FROM next WHERE o.id = next.id
     RETURNING ${jobColumns('o')}`,
    [options.now, options.limit, options.workerId, leaseUntil, jobIds],
  );
  return result.rows;
}

/**
 * Marks a claimed job DONE. The locked_by/attempts check is a fencing token:
 * if this worker's lease expired and another worker reclaimed the job, the
 * late acknowledgement changes nothing.
 */
export async function completeJob(db: Queryable, job: Pick<JobRow, 'id' | 'attempts' | 'locked_by'>, now: Date): Promise<boolean> {
  const result = await db.query(
    `UPDATE outbox_events
     SET status = 'DONE', processed_at = $2, locked_by = NULL, lease_expires_at = NULL, last_error = NULL
     WHERE id = $1 AND status = 'PROCESSING' AND locked_by = $3 AND attempts = $4`,
    [job.id, now, job.locked_by, job.attempts],
  );
  return (result.rowCount ?? 0) === 1;
}

export type FailureKind = 'RETRYABLE' | 'PERMANENT';

/** Records a failed attempt: back to PENDING with backoff, or FAILED when permanent or out of attempts. */
export async function failJob(
  db: Queryable,
  job: Pick<JobRow, 'id' | 'attempts' | 'max_attempts' | 'locked_by'>,
  failure: { kind: FailureKind; message: string; now: Date; random?: () => number },
): Promise<'retry' | 'failed' | 'stale'> {
  const final = failure.kind === 'PERMANENT' || job.attempts >= job.max_attempts;
  const delayMs = backoffDelayMs(job.attempts - 1, { ...BACKOFF, random: failure.random });
  const result = await db.query(
    `UPDATE outbox_events
     SET status = $2, available_at = $3, last_error = $4, locked_by = NULL, lease_expires_at = NULL
     WHERE id = $1 AND status = 'PROCESSING' AND locked_by = $5 AND attempts = $6`,
    [
      job.id,
      final ? 'FAILED' : 'PENDING',
      new Date(failure.now.getTime() + (final ? 0 : delayMs)),
      failure.message.slice(0, 2000),
      job.locked_by,
      job.attempts,
    ],
  );
  if ((result.rowCount ?? 0) === 0) return 'stale';
  return final ? 'failed' : 'retry';
}

/** Moves the job back to PENDING with fresh attempts. Ends the lease of a rescheduled job. */
export async function rescheduleJob(db: Queryable, job: Pick<JobRow, 'id' | 'attempts' | 'locked_by'>, availableAt: Date): Promise<void> {
  // A deliberate delay is not a failed attempt, so the claim's increment is undone.
  await db.query(
    `UPDATE outbox_events
     SET status = 'PENDING', available_at = $2, attempts = attempts - 1, locked_by = NULL, lease_expires_at = NULL
     WHERE id = $1 AND status = 'PROCESSING' AND locked_by = $3 AND attempts = $4`,
    [job.id, availableAt, job.locked_by, job.attempts],
  );
}

export type RetryJobOutcome = { kind: 'retried'; job: JobRow } | { kind: 'not_retryable'; status: JobStatus } | { kind: 'not_found' };

/** Operator action: FAILED -> PENDING with a fresh attempt budget. Runs in the caller's transaction. */
export async function retryFailedJob(tx: Tx, jobId: string, now: Date): Promise<RetryJobOutcome> {
  const current = await tx.query<{ status: JobStatus }>('SELECT status FROM outbox_events WHERE id = $1 FOR UPDATE', [jobId]);
  const row = current.rows[0];
  if (!row) return { kind: 'not_found' };
  if (row.status !== 'FAILED') return { kind: 'not_retryable', status: row.status };
  const updated = await tx.query<JobRow>(
    `UPDATE outbox_events
     SET status = 'PENDING', attempts = 0, available_at = $2, last_error = NULL, locked_by = NULL, lease_expires_at = NULL
     WHERE id = $1 RETURNING ${jobColumns()}`,
    [jobId, now],
  );
  const job = updated.rows[0];
  if (!job) return { kind: 'not_found' };
  return { kind: 'retried', job };
}

export async function outboxBacklog(db: Queryable): Promise<{ pending: number; failed: number }> {
  const result = await db.query<{ pending: number; failed: number }>(
    `SELECT count(*) FILTER (WHERE status IN ('PENDING', 'PROCESSING'))::int AS pending,
            count(*) FILTER (WHERE status = 'FAILED')::int AS failed
     FROM outbox_events WHERE status <> 'DONE'`,
  );
  return result.rows[0] ?? { pending: 0, failed: 0 };
}
