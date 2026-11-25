// Closed-loop load generator: N workers each send one request, wait for the
// response, and send the next. Latency is measured per request. A warm-up
// period runs first and is not recorded.
import { cpus, totalmem } from 'node:os';

export type LoadRequest = { url: string; init: RequestInit };

export type LoadOptions = {
  name: string;
  concurrency: number;
  durationMs: number;
  warmupMs: number;
  /** Builds the next request. `worker` and `sequence` let callers vary payloads. */
  nextRequest: (worker: number, sequence: number) => LoadRequest;
  /** Returns false for a response that counts as an error (for example a GraphQL error). */
  isSuccess?: (response: Response, body: string) => boolean;
};

export type LoadResult = {
  name: string;
  concurrency: number;
  durationSeconds: number;
  requests: number;
  errors: number;
  errorRate: number;
  throughputPerSecond: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  hardware: string;
};

export function percentile(sortedValues: readonly number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.ceil((p / 100) * sortedValues.length) - 1);
  return sortedValues[Math.max(0, index)] ?? 0;
}

export function hardwareDescription(): string {
  const cpu = cpus()[0]?.model ?? 'unknown CPU';
  return `${cpu}, ${cpus().length} logical cores, ${Math.round(totalmem() / 2 ** 30)} GiB RAM, Node ${process.version}`;
}

export async function runLoad(options: LoadOptions): Promise<LoadResult> {
  const isSuccess = options.isSuccess ?? ((response) => response.ok);
  const latencies: number[] = [];
  let errors = 0;
  let sequence = 0;

  const startedAt = performance.now();
  const recordFrom = startedAt + options.warmupMs;
  const stopAt = recordFrom + options.durationMs;

  async function worker(workerIndex: number): Promise<void> {
    while (performance.now() < stopAt) {
      const request = options.nextRequest(workerIndex, sequence++);
      const sentAt = performance.now();
      let ok: boolean;
      try {
        const response = await fetch(request.url, request.init);
        const body = await response.text();
        ok = isSuccess(response, body);
      } catch {
        ok = false;
      }
      const finishedAt = performance.now();
      if (sentAt >= recordFrom && finishedAt <= stopAt) {
        latencies.push(finishedAt - sentAt);
        if (!ok) errors += 1;
      }
    }
  }

  await Promise.all(Array.from({ length: options.concurrency }, (_, index) => worker(index)));

  latencies.sort((a, b) => a - b);
  const seconds = options.durationMs / 1000;
  const round = (value: number) => Math.round(value * 10) / 10;
  return {
    name: options.name,
    concurrency: options.concurrency,
    durationSeconds: seconds,
    requests: latencies.length,
    errors,
    errorRate: latencies.length === 0 ? 0 : round((errors / latencies.length) * 100),
    throughputPerSecond: round(latencies.length / seconds),
    p50Ms: round(percentile(latencies, 50)),
    p95Ms: round(percentile(latencies, 95)),
    p99Ms: round(percentile(latencies, 99)),
    maxMs: round(latencies.at(-1) ?? 0),
    hardware: hardwareDescription(),
  };
}
