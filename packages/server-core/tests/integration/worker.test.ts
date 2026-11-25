import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import type { ManualClock } from '../../src/clock';
import { retryJob } from '../../src/features/operations/jobs';
import { claimJobs } from '../../src/outbox/outbox';
import type { Services } from '../../src/services';
import { runWorkerUntilIdle, startWorker } from '../../src/worker/worker';
import {
  closeServices,
  createOffsetClock,
  createSku,
  expectLedgerReconciles,
  meta,
  pollUntil,
  resetData,
  scalar,
  startServices,
  testConfig,
  type BaseData,
} from '../helpers/harness';
import { jobIdsFor, orderState, placeOrder } from '../helpers/orders';

let services: Services;
let clock: ManualClock;
let base: BaseData;

beforeAll(async () => {
  clock = createOffsetClock();
  services = await startServices({ clock });
});
afterAll(async () => {
  await closeServices(services);
});
beforeEach(async () => {
  clock.set(new Date());
  base = await resetData(services);
});
afterEach(async () => {
  await expectLedgerReconciles(services);
});

type JobState = { status: string; attempts: number; locked_by: string | null };

async function job(id: string): Promise<JobState> {
  const result = await services.db.query<JobState>('SELECT status, attempts, locked_by FROM outbox_events WHERE id = $1', [id]);
  const row = result.rows[0];
  if (!row) throw new Error('job not found');
  return row;
}

describe('worker', () => {
  it('S7: a crash after the gateway charge is recovered after the lease expires', async () => {
    const sku = await createSku(services, base, { east: 5 });
    const order = await placeOrder(services, base.customer, [{ sku, quantity: 1 }]);
    const [jobId] = await jobIdsFor(services, 'payment.authorize', order.orderId);
    if (!jobId) throw new Error('no job');

    const crash = new Error('simulated crash');
    await expect(
      runWorkerUntilIdle(services, {
        jobIds: [jobId],
        faults: {
          afterSideEffect: () => {
            throw crash;
          },
        },
      }),
    ).rejects.toBe(crash);
    expect(await job(jobId)).toMatchObject({ status: 'PROCESSING', attempts: 1 });
    expect(await orderState(services, order.orderId)).toMatchObject({ status: 'PENDING_PAYMENT' });

    // Not claimable while the lease holds; claimable once it expires.
    expect(await runWorkerUntilIdle(services, { jobIds: [jobId] })).toBe(0);
    clock.advanceMs(31_000);
    expect(await runWorkerUntilIdle(services, { jobIds: [jobId] })).toBe(1);

    expect(await job(jobId)).toMatchObject({ status: 'DONE', attempts: 2 });
    expect(await orderState(services, order.orderId)).toMatchObject({ status: 'CONFIRMED', payment: 'CAPTURED' });
    expect(await scalar<number>(services, `SELECT count(*)::int AS value FROM simulated_gateway_operations WHERE operation = 'CHARGE'`)).toBe(1);
    expect(await scalar<number>(services, 'SELECT count(*)::int AS value FROM payment_events')).toBe(1);
  });

  it('a duplicate delivery of the same job (two outbox rows) has one effect', async () => {
    const sku = await createSku(services, base, { east: 5 });
    const order = await placeOrder(services, base.customer, [{ sku, quantity: 1 }]);
    await services.db.query(
      `INSERT INTO outbox_events (topic, aggregate_type, aggregate_id, payload)
       SELECT topic, aggregate_type, aggregate_id, payload FROM outbox_events WHERE topic = 'payment.authorize'`,
    );
    const ids = await jobIdsFor(services, 'payment.authorize', order.orderId);
    expect(ids).toHaveLength(2);
    await runWorkerUntilIdle(services, { jobIds: ids });
    expect(await scalar<number>(services, 'SELECT count(*)::int AS value FROM payment_events')).toBe(1);
    expect(await scalar<number>(services, `SELECT count(*)::int AS value FROM outbox_events WHERE topic = 'payment.authorize' AND status = 'DONE'`)).toBe(2);
  });

  it('concurrent workers never claim the same job twice', async () => {
    await services.db.query(
      `INSERT INTO outbox_events (topic, aggregate_type, aggregate_id) SELECT 'order.changed', 'order', 'o' || i FROM generate_series(1, 300) i`,
    );
    const claimed: string[] = [];
    await Promise.all(
      Array.from({ length: 6 }, async (_, worker) => {
        for (;;) {
          const jobs = await claimJobs(services.db, { workerId: `w${worker}`, limit: 7, now: clock.now() });
          if (jobs.length === 0) return;
          claimed.push(...jobs.map((j) => j.id));
        }
      }),
    );
    expect(claimed).toHaveLength(300);
    expect(new Set(claimed).size).toBe(300);
  });

  it('a permanent failure goes to FAILED at once; an admin retry re-queues it with an audit row', async () => {
    await services.db.query(`INSERT INTO outbox_events (topic, aggregate_type, aggregate_id) VALUES ('unknown.topic', 'x', '1')`);
    await services.db.query(`INSERT INTO outbox_events (topic, aggregate_type, aggregate_id) VALUES ('refund.process', 'refund', 'not-a-uuid')`);
    expect(await runWorkerUntilIdle(services)).toBe(2);
    const failed = await services.db.query<{ id: string; attempts: number; last_error: string }>(
      `SELECT id::text AS id, attempts, last_error FROM outbox_events WHERE status = 'FAILED' ORDER BY id`,
    );
    expect(failed.rows).toHaveLength(2);
    expect(failed.rows[0]?.attempts).toBe(1);
    expect(failed.rows[0]?.last_error).toContain('No handler');

    const id = failed.rows[0]?.id ?? '';
    await expect(retryJob(services, base.operator, id, meta())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const retried = await retryJob(services, base.admin, id, meta());
    expect(retried).toMatchObject({ kind: 'retried', job: { status: 'PENDING', attempts: 0 } });
    expect(await retryJob(services, base.admin, id, meta())).toEqual({ kind: 'not_retryable', status: 'PENDING' });
    expect(await scalar<string>(services, `SELECT action AS value FROM audit_log WHERE entity_id = $1`, [id])).toBe('job.retried');
  });

  it('S13: with Elasticsearch down, checkout works and the search job retries without being lost', async () => {
    const down = await startServices({ clock, config: testConfig({ ELASTICSEARCH_URL: 'http://127.0.0.1:9' }) });
    try {
      const sku = await createSku(down, base, { east: 5 });
      await expect(down.search.search({ text: 'x' }, 5, null)).rejects.toMatchObject({ code: 'SEARCH_UNAVAILABLE' });
      const order = await placeOrder(down, base.customer, [{ sku, quantity: 1 }]);
      const [searchJob] = await jobIdsFor(down, 'search.product_changed', sku.productId);
      if (!searchJob) throw new Error('no search job');
      await runWorkerUntilIdle(down, { jobIds: [searchJob] });
      const state = await down.db.query<{ status: string; attempts: number; last_error: string; available_at: Date }>(
        'SELECT status, attempts, last_error, available_at FROM outbox_events WHERE id = $1',
        [searchJob],
      );
      expect(state.rows[0]).toMatchObject({ status: 'PENDING', attempts: 1 });
      expect(state.rows[0]?.last_error).toMatch(/Connection|connect/i);
      expect(await orderState(down, order.orderId)).toMatchObject({ status: 'PENDING_PAYMENT' });
    } finally {
      await closeServices(down);
    }
  });

  it('the sweeper enqueues expiry for overdue holds and the worker expires them', async () => {
    const sku = await createSku(services, base, { east: 5 });
    const order = await placeOrder(services, base.customer, [{ sku, quantity: 1 }]);
    // Lose the scheduled job, then let time pass beyond the hold.
    await services.db.query(`DELETE FROM outbox_events WHERE topic IN ('reservation.expire', 'payment.authorize')`);
    clock.advanceMs(16 * 60_000);
    await runWorkerUntilIdle(services);
    expect(await orderState(services, order.orderId)).toMatchObject({ status: 'CANCELLED', reason: 'RESERVATION_EXPIRED' });
  });

  it('startWorker processes jobs in the background and stop() waits for in-flight work', async () => {
    const real = await startServices();
    try {
      const sku = await createSku(real, base, { east: 5 });
      const order = await placeOrder(real, base.customer, [{ sku, quantity: 1 }]);
      const worker = startWorker(real, { workerId: 'bg-worker', pollIntervalMs: 20 });
      await pollUntil(async () => (await orderState(real, order.orderId)).status === 'CONFIRMED');
      await worker.stop();
    } finally {
      await closeServices(real);
    }
  });
});
