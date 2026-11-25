import { expect, it } from '@jest/globals';
import type { Scenario } from './types';

class SimulatedCrash extends Error {
  constructor() {
    super('simulated worker crash after the external side effect');
    this.name = 'SimulatedCrash';
  }
}

export const s07WorkerCrash: Scenario = (context) => {
  it('S7 worker stops after an external side effect, before acknowledgement, and recovers', async () => {
    const ctx = context();
    const sku = await ctx.createSku('CRASH', 2200, { east: 5 });
    const order = await ctx.placeOrder(ctx.clients.customer, [{ sku, quantity: 1 }], 'tok_approve');
    const paymentId = order.payment!.id;
    const [job] = await ctx.db.jobs('payment.authorize', [order.id, paymentId]);
    expect(job).toBeDefined();
    const jobId = job!.id;

    const crash = ctx.runJobs([jobId], {
      afterSideEffect: () => {
        throw new SimulatedCrash();
      },
    });
    await expect(crash).rejects.toThrow(SimulatedCrash);
    const abandoned = await ctx.db.job(jobId);
    expect(abandoned.status).toBe('PROCESSING');
    expect(await ctx.db.countWhere('simulated_gateway_operations', 'idempotency_key', paymentId)).toBe(1);

    await ctx.db.expireLease(jobId);
    await ctx.runJobs([jobId]);

    const finished = await ctx.db.job(jobId);
    expect(finished.status).toBe('DONE');
    expect(finished.attempts).toBeGreaterThanOrEqual(2);
    expect((await ctx.db.order(order.id)).status).toBe('CONFIRMED');
    expect(await ctx.db.countWhere('simulated_gateway_operations', 'idempotency_key', paymentId)).toBe(1);
    expect(await ctx.db.countWhere('payment_events', 'payment_id', paymentId)).toBe(1);
  });
};
