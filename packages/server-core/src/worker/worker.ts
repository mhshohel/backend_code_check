import { classifyError } from '@ofl/domain';
import { claimJobs, completeJob, failJob, outboxBacklog, rescheduleJob, type JobRow } from '../outbox/outbox';
import type { Services } from '../services';
import { JOB_HANDLERS, PermanentJobError } from './handlers';
import { enqueueOverdueExpiries } from './sweeper';

export type WorkerJobInfo = { id: string; topic: string; attempts: number };

/** Test hooks for fault injection. */
export type WorkerFaults = {
  /** Runs after the external call (gateway, Elasticsearch) and before the job is acknowledged. */
  afterSideEffect?: (job: WorkerJobInfo) => void | Promise<void>;
};

/**
 * Wraps an error thrown by a fault hook. It simulates a process crash, so
 * the worker must not record a failure: the job keeps its lease and becomes
 * claimable again only when the lease expires.
 */
class SimulatedCrash extends Error {
  constructor(readonly original: unknown) {
    super('Simulated worker crash.');
    this.name = 'SimulatedCrash';
  }
}

export type JobOutcome = 'done' | 'retry' | 'failed' | 'rescheduled' | 'stale';

export async function processJob(services: Services, job: JobRow, faults: WorkerFaults = {}): Promise<JobOutcome> {
  const startedAt = services.clock.now();
  services.metrics.observeJobLag(job.topic, startedAt.getTime() - job.available_at.getTime());
  const log = services.logger.child({ jobId: job.id, topic: job.topic, attempts: job.attempts, correlationId: job.correlation_id });
  const handler = JOB_HANDLERS[job.topic];

  try {
    if (!handler) throw new PermanentJobError(`No handler for topic ${job.topic}.`);
    const afterSideEffect = async () => {
      if (!faults.afterSideEffect) return;
      try {
        await faults.afterSideEffect({ id: job.id, topic: job.topic, attempts: job.attempts });
      } catch (error) {
        throw new SimulatedCrash(error);
      }
    };
    const meta = { correlationId: job.correlation_id ?? `job-${job.id}` };
    const result = await handler(services, job, meta, afterSideEffect);
    if (result.kind === 'reschedule') {
      await rescheduleJob(services.db, job, result.availableAt);
      log.debug({ availableAt: result.availableAt }, 'job rescheduled');
      return 'rescheduled';
    }
    const acknowledged = await completeJob(services.db, job, services.clock.now());
    if (!acknowledged) {
      log.warn('job lease was lost before completion; another worker owns it now');
      return 'stale';
    }
    services.metrics.jobProcessed(job.topic);
    log.debug('job done');
    return 'done';
  } catch (error) {
    if (error instanceof SimulatedCrash) throw error.original;
    const kind = classifyError(error);
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    const outcome = await failJob(services.db, job, { kind, message, now: services.clock.now() });
    services.metrics.jobFailed(job.topic, outcome === 'failed');
    if (outcome === 'failed') log.error({ err: error }, 'job failed permanently');
    else log.warn({ err: error, kind }, 'job attempt failed');
    return outcome === 'stale' ? 'stale' : outcome;
  }
}

export type RunUntilIdleOptions = {
  workerId?: string;
  maxJobs?: number;
  /** Claim only these outbox_events ids. */
  jobIds?: string[];
  faults?: WorkerFaults;
};

/**
 * Processes claimable jobs one at a time until none is left (or maxJobs).
 * Returns the number of jobs processed. Used by tests and the CLI.
 */
export async function runWorkerUntilIdle(services: Services, options: RunUntilIdleOptions = {}): Promise<number> {
  const workerId = options.workerId ?? `idle-runner-${process.pid}`;
  const maxJobs = options.maxJobs ?? Number.POSITIVE_INFINITY;
  if (!options.jobIds) await enqueueOverdueExpiries(services);

  let processed = 0;
  while (processed < maxJobs) {
    const [job] = await claimJobs(services.db, { workerId, limit: 1, now: services.clock.now(), jobIds: options.jobIds });
    if (!job) break;
    await processJob(services, job, options.faults);
    processed += 1;
  }
  return processed;
}

export type WorkerOptions = {
  workerId: string;
  concurrency?: number;
  pollIntervalMs?: number;
  sweepIntervalMs?: number;
  faults?: WorkerFaults;
};

export type WorkerHandle = { stop(): Promise<void> };

/** Long-running worker loop. stop() lets in-flight jobs finish, then resolves. */
export function startWorker(services: Services, options: WorkerOptions): WorkerHandle {
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const pollIntervalMs = options.pollIntervalMs ?? 500;
  const sweepIntervalMs = options.sweepIntervalMs ?? 10_000;
  let stopping = false;
  let wakeSleeper: (() => void) | null = null;
  let lastSweep = 0;

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        wakeSleeper = null;
        resolve();
      }
      wakeSleeper = done;
    });

  async function tick(): Promise<number> {
    const now = services.clock.now().getTime();
    if (now - lastSweep >= sweepIntervalMs) {
      lastSweep = now;
      await enqueueOverdueExpiries(services);
      const backlog = await outboxBacklog(services.db);
      services.metrics.setOutboxBacklog(backlog.pending, backlog.failed);
    }
    const jobs = await claimJobs(services.db, { workerId: options.workerId, limit: concurrency, now: services.clock.now() });
    await Promise.all(jobs.map((job) => processJob(services, job, options.faults)));
    return jobs.length;
  }

  const loop = (async () => {
    services.logger.info({ workerId: options.workerId, concurrency }, 'worker started');
    while (!stopping) {
      let claimed = 0;
      try {
        claimed = await tick();
      } catch (error) {
        services.logger.error({ err: error }, 'worker loop error');
      }
      if (claimed === 0 && !stopping) await sleep(pollIntervalMs);
    }
    services.logger.info({ workerId: options.workerId }, 'worker stopped');
  })();

  return {
    async stop() {
      stopping = true;
      wakeSleeper?.();
      await loop;
    },
  };
}
