import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export type HttpObservation = { method: string; route: string; status: number; durationMs: number };

export type Metrics = {
  readonly registry: Registry;
  observeHttp(observation: HttpObservation): void;
  graphqlError(operationName: string, code: string): void;
  jobProcessed(topic: string): void;
  jobFailed(topic: string, finalFailure: boolean): void;
  observeJobLag(topic: string, lagMs: number): void;
  setOutboxBacklog(pending: number, failed: number): void;
  render(): Promise<string>;
  contentType: string;
};

/** One registry per Services instance, so tests can run several in one process. */
export function createMetrics(options: { defaultMetrics?: boolean } = {}): Metrics {
  const registry = new Registry();
  if (options.defaultMetrics) collectDefaultMetrics({ register: registry, prefix: 'ofl_' });

  const httpDuration = new Histogram({
    name: 'ofl_http_request_duration_seconds',
    help: 'HTTP request latency.',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  });
  const graphqlErrors = new Counter({
    name: 'ofl_graphql_operation_errors_total',
    help: 'GraphQL errors by operation and code.',
    labelNames: ['operation', 'code'],
    registers: [registry],
  });
  const jobsProcessed = new Counter({
    name: 'ofl_worker_jobs_processed_total',
    help: 'Outbox jobs completed.',
    labelNames: ['topic'],
    registers: [registry],
  });
  const jobsFailed = new Counter({
    name: 'ofl_worker_jobs_failed_total',
    help: 'Outbox job attempts that failed. final=true when the job moved to FAILED.',
    labelNames: ['topic', 'final'],
    registers: [registry],
  });
  const jobLag = new Histogram({
    name: 'ofl_worker_job_lag_seconds',
    help: 'Delay between a job becoming available and a worker claiming it.',
    labelNames: ['topic'],
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 300],
    registers: [registry],
  });
  const backlog = new Gauge({
    name: 'ofl_outbox_backlog',
    help: 'Outbox rows by state (pending includes processing).',
    labelNames: ['state'],
    registers: [registry],
  });

  return {
    registry,
    contentType: registry.contentType,
    observeHttp: ({ method, route, status, durationMs }) =>
      httpDuration.observe({ method, route, status: String(status) }, durationMs / 1000),
    graphqlError: (operation, code) => graphqlErrors.inc({ operation, code }),
    jobProcessed: (topic) => jobsProcessed.inc({ topic }),
    jobFailed: (topic, finalFailure) => jobsFailed.inc({ topic, final: String(finalFailure) }),
    observeJobLag: (topic, lagMs) => jobLag.observe({ topic }, Math.max(0, lagMs) / 1000),
    setOutboxBacklog: (pending, failed) => {
      backlog.set({ state: 'pending' }, pending);
      backlog.set({ state: 'failed' }, failed);
    },
    render: () => registry.metrics(),
  };
}
