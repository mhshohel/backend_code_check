import { randomUUID } from 'node:crypto';
import { expect, it } from '@jest/globals';
import { postWebhook, type PaymentNotificationBody } from '../support/webhook';
import type { Scenario } from './types';

export const s04DuplicateNotifications: Scenario = (context) => {
  it('S4 duplicate payment notifications are processed once', async () => {
    const ctx = context();
    const secret = ctx.target.config.paymentWebhookSecret;
    const sku = await ctx.createSku('WEBHOOK', 3000, { east: 10 });
    const order = await ctx.placeOrder(ctx.clients.customer, [{ sku, quantity: 1 }]);
    const payment = await ctx.db.payment(order.id);
    const body: PaymentNotificationBody = {
      providerEventId: `evt_acc_${randomUUID()}`,
      paymentId: payment.id,
      kind: 'PAYMENT_SUCCEEDED',
      amountMinor: payment.amountMinor,
    };

    const concurrent = await Promise.all([1, 2, 3].map(() => postWebhook(ctx.webhookUrl, body, secret)));
    const sequential = [await postWebhook(ctx.webhookUrl, body, secret), await postWebhook(ctx.webhookUrl, body, secret)];

    const responses = [...concurrent, ...sequential];
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200, 200]);
    const statuses = responses.map((response) => response.body.status);
    expect(statuses.filter((status) => status === 'processed')).toHaveLength(1);
    expect(statuses.filter((status) => status === 'duplicate')).toHaveLength(4);
    expect(sequential.map((response) => response.body.status)).toEqual(['duplicate', 'duplicate']);

    expect((await ctx.db.order(order.id)).status).toBe('CONFIRMED');
    expect(await ctx.db.countWhere('payment_events', 'payment_id', payment.id)).toBe(1);
    expect(await ctx.db.reservationStatuses(order.id)).toEqual(['CONFIRMED']);
    expect((await ctx.db.payment(order.id)).status).toBe('CAPTURED');
    expect((await ctx.db.movements(sku.id)).map((movement) => movement.kind)).toEqual(['RECEIPT', 'RESERVE']);

    const forged = await postWebhook(ctx.webhookUrl, { ...body, providerEventId: `evt_acc_${randomUUID()}` }, secret, {
      badSignature: true,
    });
    expect(forged.status).toBe(401);
  });
};
