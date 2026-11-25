// Repeatable load scenarios against the bench dataset (ofl_bench).
// Prerequisites: pnpm infra:up, pnpm db:create, bench profile loaded:
//   BENCH_CUSTOMERS=40 DATABASE_URL=.../ofl_bench ES_INDEX_PREFIX=ofl_bench_ ofl-seed --profile bench
// Usage: pnpm bench [express|fastify ...]   (default: express fastify)
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import {
  CheckoutDocument,
  MyOrdersDocument,
  OperatorOrdersDocument,
  SearchProductsDocument,
} from '@ofl/graphql-types';
import { createServices, closeServices, loadConfig, reconcileLedger, startWorker } from '@ofl/server-core';
import { print, type DocumentNode } from 'graphql';
import pg from 'pg';
import { hardwareDescription, percentile, runLoad, type LoadResult } from './load';

const ENV = {
  DATABASE_URL: 'postgresql://shohelshamim@localhost:5432/ofl_bench',
  ELASTICSEARCH_URL: 'http://127.0.0.1:9200',
  ES_INDEX_PREFIX: 'ofl_bench_',
  PAYMENT_WEBHOOK_SECRET: 'bench-secret-0123456789',
  ENABLE_QUERY_COUNT: 'true',
  LOG_LEVEL: 'silent',
  NODE_ENV: 'production',
  DB_POOL_MAX: '20',
};
Object.assign(process.env, ENV);

// 4190 is on the Fetch standard's blocked-port list, so fetch() refuses it.
const PORTS = { express: 4180, fastify: 4280 } as const;
type Variant = keyof typeof PORTS;
const DURATION_MS = Number(process.env.BENCH_DURATION_MS ?? 15_000);
const WARMUP_MS = 3_000;
const SEARCH_WORDS = ['wireless', 'lamp', 'speaker', 'premium', 'kettle', 'chair', 'portable', 'monitor', 'drone', 'tent'];

const db = new pg.Pool({ connectionString: ENV.DATABASE_URL, max: 4 });

function graphqlBody(document: DocumentNode, variables: Record<string, unknown>): string {
  return JSON.stringify({ query: print(document), variables });
}

function noGraphQLErrors(response: Response, body: string): boolean {
  return response.ok && !body.includes('"errors"');
}

/**
 * Reloads the bench profile so that every variant and the worker start from
 * the same data. Earlier runs add orders and leave payment jobs in the outbox,
 * which would otherwise change later results.
 */
async function reseed(): Promise<void> {
  const child = spawn('node', ['packages/test-fixtures/bin/ofl-seed.js', '--profile', 'bench'], {
    env: { ...process.env, NODE_ENV: 'development', BENCH_CUSTOMERS: '40' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const code = await new Promise<number | null>((resolve) => child.once('exit', resolve));
  if (code !== 0) throw new Error(`ofl-seed exited with ${code}`);
}

async function startServer(variant: Variant): Promise<ChildProcess> {
  const child = spawn('pnpm', ['exec', 'tsx', 'scripts/bench/serve.ts', variant, String(PORTS[variant])], {
    env: process.env,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const baseUrl = `http://127.0.0.1:${PORTS[variant]}`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const ready = await fetch(`${baseUrl}/health/live`).then((r) => r.ok, () => false);
    if (ready) return child;
    await new Promise((resolve) => setTimeout(resolve, 200)); // bounded readiness poll
  }
  child.kill('SIGTERM');
  throw new Error(`${variant} did not start`);
}

async function stopServer(child: ChildProcess): Promise<void> {
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  await exited;
}

async function login(baseUrl: string, email: string, password: string): Promise<string> {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ofl-csrf': '1' },
    body: JSON.stringify({ email, password }),
  });
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  if (!response.ok || !cookie) throw new Error(`login failed for ${email}: ${response.status}`);
  return cookie;
}

function graphqlRequest(baseUrl: string, body: string, cookie?: string, extraHeaders: Record<string, string> = {}) {
  return {
    url: `${baseUrl}/graphql`,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ofl-csrf': '1', ...(cookie ? { cookie } : {}), ...extraHeaders },
      body,
    },
  };
}

async function measureQueryCounts(baseUrl: string, operatorCookie: string): Promise<Record<number, number>> {
  const counts: Record<number, number> = {};
  for (const first of [5, 20, 50]) {
    const response = await fetch(`${baseUrl}/graphql`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ofl-csrf': '1', cookie: operatorCookie, 'x-ofl-debug-query-count': '1' },
      body: graphqlBody(OperatorOrdersDocument, { first }),
    });
    const json = (await response.json()) as { extensions?: { queryCount?: number }; data?: { orders: { edges: unknown[] } } };
    counts[first] = json.extensions?.queryCount ?? -1;
    if ((json.data?.orders.edges.length ?? 0) !== first) throw new Error(`expected ${first} orders`);
  }
  return counts;
}

type SkuRow = { id: string; price_minor: number; available: number };

async function checkoutCandidates(): Promise<SkuRow[]> {
  const result = await db.query<SkuRow>(
    `SELECT s.id, s.price_minor::int AS price_minor, sum(b.on_hand - b.reserved)::int AS available
     FROM skus s JOIN inventory_balances b ON b.sku_id = s.id
     GROUP BY s.id HAVING sum(b.on_hand - b.reserved) >= 200
     ORDER BY s.id LIMIT 2000`,
  );
  return result.rows;
}

async function skuAvailability(skuId: string): Promise<number> {
  const result = await db.query<{ available: number }>(
    'SELECT sum(on_hand - reserved)::int AS available FROM inventory_balances WHERE sku_id = $1',
    [skuId],
  );
  return result.rows[0]?.available ?? 0;
}

function checkoutBody(sku: SkuRow): string {
  return graphqlBody(CheckoutDocument, {
    input: {
      idempotencyKey: randomUUID(),
      paymentToken: 'tok_approve',
      lines: [{ skuId: sku.id, quantity: 1, expectedUnitPriceMinor: sku.price_minor }],
    },
  });
}

type CheckoutTally = { succeeded: number; insufficient: number };

function tallyCheckout(tally: CheckoutTally) {
  return (response: Response, body: string): boolean => {
    if (!noGraphQLErrors(response, body)) return false;
    if (body.includes('"CheckoutSucceeded"')) tally.succeeded += 1;
    else if (body.includes('"InsufficientStock"')) tally.insufficient += 1;
    else return false;
    return true;
  };
}

type VariantReport = {
  variant: Variant;
  loads: LoadResult[];
  queryCounts: Record<number, number>;
  hotSku: { initialAvailable: number; succeeded: number; insufficient: number; finalAvailable: number };
  distinctCheckouts: CheckoutTally;
  ledgerDifferences: number;
};

async function benchmarkVariant(variant: Variant): Promise<VariantReport> {
  const server = await startServer(variant);
  const baseUrl = `http://127.0.0.1:${PORTS[variant]}`;
  try {
    const customerCookie = await login(baseUrl, 'bench1@example.com', 'bench-pass-1');
    const operatorCookie = await login(baseUrl, 'operator@example.com', 'operator-pass-1');
    const loads: LoadResult[] = [];

    loads.push(
      await runLoad({
        name: `${variant}: product search`,
        concurrency: 20,
        durationMs: DURATION_MS,
        warmupMs: WARMUP_MS,
        nextRequest: (_worker, n) =>
          graphqlRequest(
            baseUrl,
            graphqlBody(SearchProductsDocument, {
              input: { text: SEARCH_WORDS[n % SEARCH_WORDS.length], inStockOnly: n % 2 === 0 },
              first: 20,
            }),
          ),
        isSuccess: noGraphQLErrors,
      }),
    );

    const myOrdersBody = graphqlBody(MyOrdersDocument, { first: 20 });
    loads.push(
      await runLoad({
        name: `${variant}: my orders first page (customer with 5000 orders)`,
        concurrency: 20,
        durationMs: DURATION_MS,
        warmupMs: WARMUP_MS,
        nextRequest: () => graphqlRequest(baseUrl, myOrdersBody, customerCookie),
        isSuccess: noGraphQLErrors,
      }),
    );

    const queryCounts = await measureQueryCounts(baseUrl, operatorCookie);

    const candidates = await checkoutCandidates();
    const distinctCheckouts: CheckoutTally = { succeeded: 0, insufficient: 0 };
    loads.push(
      await runLoad({
        name: `${variant}: checkout, distinct SKUs`,
        concurrency: 50,
        durationMs: DURATION_MS,
        warmupMs: WARMUP_MS,
        nextRequest: (_worker, n) => graphqlRequest(baseUrl, checkoutBody(candidates[n % candidates.length]!), customerCookie),
        isSuccess: tallyCheckout(distinctCheckouts),
      }),
    );

    // Hot SKU: limit availability so that stock runs out during the run.
    const hot = candidates[candidates.length - 1]!;
    const initialAvailable = await skuAvailability(hot.id);
    const hotTally: CheckoutTally = { succeeded: 0, insufficient: 0 };
    loads.push(
      await runLoad({
        name: `${variant}: checkout, one hot SKU`,
        concurrency: 50,
        durationMs: DURATION_MS,
        warmupMs: 0, // every reservation must be counted for the oversell check
        nextRequest: () => graphqlRequest(baseUrl, checkoutBody(hot), customerCookie),
        isSuccess: tallyCheckout(hotTally),
      }),
    );
    const finalAvailable = await skuAvailability(hot.id);

    return {
      variant,
      loads,
      queryCounts,
      hotSku: { initialAvailable, ...hotTally, finalAvailable },
      distinctCheckouts,
      ledgerDifferences: -1,
    };
  } finally {
    await stopServer(server);
  }
}

type WorkerReport = { jobs: number; concurrency: number; seconds: number; jobsPerSecond: number; lagP50Ms: number; lagP95Ms: number; failed: number };

async function benchmarkWorker(concurrency: number): Promise<WorkerReport> {
  const jobs = 5000;
  const services = await createServices(loadConfig(process.env), { role: 'worker' });
  try {
    const inserted = await db.query<{ id: string }>(
      `INSERT INTO outbox_events (topic, aggregate_type, aggregate_id, payload)
       SELECT 'search.product_changed', 'product', id::text, jsonb_build_object('productId', id)
       FROM products ORDER BY id LIMIT $1 RETURNING id`,
      [jobs],
    );
    const ids = inserted.rows.map((row) => row.id);
    const started = performance.now();
    const worker = startWorker(services, { workerId: `bench-worker-${concurrency}`, concurrency, pollIntervalMs: 50 });
    let remaining = jobs;
    while (remaining > 0 && performance.now() - started < 300_000) {
      await new Promise((resolve) => setTimeout(resolve, 100)); // bounded progress poll
      const result = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM outbox_events WHERE id = ANY($1::bigint[]) AND status IN ('PENDING','PROCESSING')`,
        [ids],
      );
      remaining = result.rows[0]?.n ?? 0;
    }
    const seconds = (performance.now() - started) / 1000;
    await worker.stop();

    const lags = await db.query<{ lag_ms: number; status: string }>(
      `SELECT extract(epoch FROM processed_at - created_at) * 1000 AS lag_ms, status
       FROM outbox_events WHERE id = ANY($1::bigint[])`,
      [ids],
    );
    const sorted = lags.rows.filter((row) => row.status === 'DONE').map((row) => Number(row.lag_ms)).sort((a, b) => a - b);
    return {
      jobs,
      concurrency,
      seconds: Math.round(seconds * 10) / 10,
      jobsPerSecond: Math.round(jobs / seconds),
      lagP50Ms: Math.round(percentile(sorted, 50)),
      lagP95Ms: Math.round(percentile(sorted, 95)),
      failed: lags.rows.filter((row) => row.status !== 'DONE').length,
    };
  } finally {
    await closeServices(services);
  }
}

async function datasetDescription(): Promise<string> {
  const result = await db.query<{ products: number; orders: number; movements: number; customers: number }>(
    `SELECT (SELECT count(*) FROM products)::int AS products, (SELECT count(*) FROM orders)::int AS orders,
            (SELECT count(*) FROM inventory_movements)::int AS movements,
            (SELECT count(*) FROM users WHERE role = 'CUSTOMER')::int AS customers`,
  );
  const row = result.rows[0]!;
  return `${row.products} products, ${row.orders} orders, ${row.movements} inventory movements, ${row.customers} customers`;
}

function renderReport(dataset: string, variants: VariantReport[], workers: WorkerReport[]): string {
  const loadRows = variants
    .flatMap((v) => v.loads)
    .map(
      (l) =>
        `| ${l.name} | ${l.concurrency} | ${l.durationSeconds} s | ${l.requests} | ${l.throughputPerSecond} | ${l.p50Ms} | ${l.p95Ms} | ${l.p99Ms} | ${l.errorRate} % |`,
    )
    .join('\n');
  const variantRows = variants
    .map(
      (v) =>
        `| ${v.variant} | ${v.queryCounts[5]} / ${v.queryCounts[20]} / ${v.queryCounts[50]} | ${v.distinctCheckouts.succeeded} ok, ${v.distinctCheckouts.insufficient} short | ${v.hotSku.initialAvailable} → ${v.hotSku.finalAvailable}; ${v.hotSku.succeeded} reserved, ${v.hotSku.insufficient} InsufficientStock | ${v.ledgerDifferences} |`,
    )
    .join('\n');
  return `# Benchmark results

Generated by \`scripts/bench/run-benchmarks.ts\` on ${new Date().toISOString()}.

- Hardware: ${hardwareDescription()}; PostgreSQL 17 (Homebrew, local); Elasticsearch 9.2.4 in Docker (1 GB heap).
- Dataset (ofl_bench, bench profile with BENCH_CUSTOMERS=40): ${dataset}.
- The bench data is reloaded before the worker run and before each variant, so every run starts from the same state.
- Load generator and server run on the same machine. Closed loop: each connection sends its next request after the previous response.
- Warm-up ${WARMUP_MS / 1000} s (not recorded) except for the hot-SKU run. Server started with raised rate limits (scripts/bench/serve.ts), NODE_ENV=production, DB_POOL_MAX=20.
- An error is an HTTP failure or a GraphQL \`errors\` entry. \`InsufficientStock\` is a correct business result, not an error.

## HTTP scenarios

| Scenario | Connections | Duration | Requests | Throughput (req/s) | p50 ms | p95 ms | p99 ms | Errors |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
${loadRows}

## Correctness under load

| Variant | DB queries for OperatorOrders(first: 5 / 20 / 50) | Distinct-SKU checkouts | Hot SKU (available before → after) | Ledger differences after run |
| --- | --- | --- | --- | --- |
${variantRows}

## Worker

| Jobs | Concurrency | Time | Throughput | Lag p50 | Lag p95 | Not DONE |
| --- | --- | --- | --- | --- | --- | --- |
${workers.map((worker) => `| ${worker.jobs} \`search.product_changed\` | ${worker.concurrency} | ${worker.seconds} s | ${worker.jobsPerSecond} jobs/s | ${worker.lagP50Ms} ms | ${worker.lagP95Ms} ms | ${worker.failed} |`).join('\n')}

Lag = \`processed_at - created_at\`. All jobs were enqueued at once into an otherwise empty outbox, so lag measures how long the backlog takes to drain, not steady-state latency. Each job re-reads the product, its SKUs, and balances from PostgreSQL and indexes one document.
`;
}

const requested = process.argv.slice(2).filter((arg): arg is Variant => arg === 'express' || arg === 'fastify');
const variants: Variant[] = requested.length > 0 ? requested : ['express', 'fastify'];

try {
  await reseed();
  const dataset = await datasetDescription();
  // The jobs of one run are all DONE before the next run, so the outbox is empty again.
  const workers = [await benchmarkWorker(4), await benchmarkWorker(16)];
  console.warn(JSON.stringify(workers, null, 2));
  const reports: VariantReport[] = [];
  for (const variant of variants) {
    await reseed();
    const report = await benchmarkVariant(variant);
    // Reconciliation aggregates the whole ledger (800k+ rows), so it needs more
    // than the 5 s request timeout.
    const services = await createServices(loadConfig({ ...process.env, STATEMENT_TIMEOUT_MS: '60000' }), { role: 'cli' });
    report.ledgerDifferences = (await reconcileLedger(services)).differences.length;
    await closeServices(services);
    reports.push(report);
    console.warn(JSON.stringify(report, null, 2));
  }
  const markdown = renderReport(dataset, reports, workers);
  writeFileSync(new URL('../../reports/benchmarks.md', import.meta.url), markdown);
  writeFileSync(new URL('../../reports/benchmarks.json', import.meta.url), JSON.stringify({ dataset, reports, workers }, null, 2));
} finally {
  await db.end();
}
