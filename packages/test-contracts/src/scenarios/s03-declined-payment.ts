import { expect, it } from '@jest/globals';
import type { Scenario } from './types';

export const s03DeclinedPayment: Scenario = (context) => {
  it('S3 declined payment releases stock once', async () => {
    const ctx = context();
    const { east } = ctx.warehouses;
    const sku = await ctx.createSku('DECLINE', 1200, { east: 10 });
    const order = await ctx.placeOrder(ctx.clients.customer, [{ sku, quantity: 2 }], 'tok_decline');
    const [job] = await ctx.db.jobs('payment.authorize', [order.id, order.payment!.id]);
    expect(job).toBeDefined();

    await ctx.runJobs([job!.id]);

    expect(await ctx.db.order(order.id)).toEqual({ status: 'CANCELLED', cancellationReason: 'PAYMENT_DECLINED' });
    expect((await ctx.db.payment(order.id)).status).toBe('DECLINED');
    expect(await ctx.db.balance(sku.id, east)).toEqual({ onHand: 10, reserved: 0 });
    const kindsAfterFirstRun = (await ctx.db.movements(sku.id)).map((movement) => movement.kind);
    expect(kindsAfterFirstRun).toEqual(['RECEIPT', 'RESERVE', 'RELEASE']);

    await ctx.db.makeJobClaimableAgain(job!.id);
    await ctx.runJobs([job!.id]);

    expect((await ctx.db.movements(sku.id)).map((movement) => movement.kind)).toEqual(kindsAfterFirstRun);
    expect(await ctx.db.balance(sku.id, east)).toEqual({ onHand: 10, reserved: 0 });
    expect(await ctx.db.order(order.id)).toEqual({ status: 'CANCELLED', cancellationReason: 'PAYMENT_DECLINED' });
  });
};
