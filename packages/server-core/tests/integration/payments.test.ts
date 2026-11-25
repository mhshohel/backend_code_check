import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { cancelOrder, expireOrderReservations } from '../../src/features/orders/operations';
import { handlePaymentWebhook, recordPaymentNotification, signWebhookBody } from '../../src/features/payments/notifications';
import type { Services } from '../../src/services';
import { runWorkerUntilIdle } from '../../src/worker/worker';
import {
  balance,
  closeServices,
  createSku,
  expectLedgerReconciles,
  meta,
  movementCounts,
  resetData,
  scalar,
  startServices,
  WAREHOUSE_EAST,
  type BaseData,
} from '../helpers/harness';
import { authorize, jobIdsFor, orderState, placeOrder, reservationStatuses } from '../helpers/orders';

let services: Services;
let base: BaseData;

beforeAll(async () => {
  services = await startServices();
});
afterAll(async () => {
  await closeServices(services);
});
beforeEach(async () => {
  base = await resetData(services);
});
afterEach(async () => {
  await expectLedgerReconciles(services);
});

const succeeded = (order: { paymentId: string; amountMinor: number }, providerEventId: string) => ({
  providerEventId,
  paymentId: order.paymentId,
  kind: 'PAYMENT_SUCCEEDED' as const,
  amountMinor: order.amountMinor,
});

async function expireNow(orderId: string): Promise<void> {
  await services.db.query(`UPDATE reservations SET expires_at = now() - interval '1 minute' WHERE order_id = $1`, [orderId]);
  await services.db.query(`UPDATE orders SET reservation_expires_at = now() - interval '1 minute' WHERE id = $1`, [orderId]);
}

describe('payment authorization', () => {
  it('confirms the order and its reservations on approval', async () => {
    const sku = await createSku(services, base, { east: 5 });
    const order = await placeOrder(services, base.customer, [{ sku, quantity: 2 }]);
    await authorize(services, order);
    expect(await orderState(services, order.orderId)).toEqual({ status: 'CONFIRMED', reason: null, payment: 'CAPTURED' });
    expect(await reservationStatuses(services, order.orderId)).toEqual(['CONFIRMED']);
  });

  it('S3: a declined payment cancels the order and releases stock once', async () => {
    const sku = await createSku(services, base, { east: 10 });
    const order = await placeOrder(services, base.customer, [{ sku, quantity: 2 }], 'tok_decline');
    await authorize(services, order);
    expect(await orderState(services, order.orderId)).toEqual({ status: 'CANCELLED', reason: 'PAYMENT_DECLINED', payment: 'DECLINED' });
    expect(await balance(services, sku.skuId, WAREHOUSE_EAST)).toEqual({ onHand: 10, reserved: 0 });
    expect(await movementCounts(services, { referenceId: order.orderId })).toEqual({ RESERVE: 1, RELEASE: 1 });

    // Processing the same job again changes nothing.
    await services.db.query(`UPDATE outbox_events SET status = 'PENDING', available_at = now() WHERE topic = 'payment.authorize'`);
    await authorize(services, order);
    expect(await movementCounts(services, { referenceId: order.orderId })).toEqual({ RESERVE: 1, RELEASE: 1 });
    expect(await scalar<number>(services, 'SELECT count(*)::int AS value FROM simulated_gateway_operations')).toBe(1);
  });

  it('a later worker success for an order already confirmed by webhook is a no-op', async () => {
    const sku = await createSku(services, base, { east: 5 });
    const order = await placeOrder(services, base.customer, [{ sku, quantity: 1 }]);
    await recordPaymentNotification(services, succeeded(order, 'evt_webhook_1'), meta());
    await authorize(services, order);
    expect(await orderState(services, order.orderId)).toEqual({ status: 'CONFIRMED', reason: null, payment: 'CAPTURED' });
    expect(await scalar<number>(services, 'SELECT count(*)::int AS value FROM refunds')).toBe(0);
  });
});

describe('payment webhook', () => {
  it('S4: duplicate notifications are processed once', async () => {
    const sku = await createSku(services, base, { east: 5 });
    const order = await placeOrder(services, base.customer, [{ sku, quantity: 1 }]);
    const body = JSON.stringify(succeeded(order, 'evt_dup_1'));
    const signature = signWebhookBody(body, services.config.paymentWebhookSecret);

    const concurrent = await Promise.all([1, 2, 3].map(() => handlePaymentWebhook(services, body, signature, meta())));
    const sequential = [await handlePaymentWebhook(services, body, signature, meta()), await handlePaymentWebhook(services, body, signature, meta())];
    const statuses = [...concurrent, ...sequential].map((r) => r.body);
    expect(statuses.filter((b) => 'status' in b && b.status === 'processed')).toHaveLength(1);
    expect(statuses.filter((b) => 'status' in b && b.status === 'duplicate')).toHaveLength(4);
    expect(await scalar<number>(services, 'SELECT count(*)::int AS value FROM payment_events')).toBe(1);
    expect(await orderState(services, order.orderId)).toEqual({ status: 'CONFIRMED', reason: null, payment: 'CAPTURED' });
    expect(await movementCounts(services, { referenceId: order.orderId })).toEqual({ RESERVE: 1 });
  });

  it('rejects bad signatures with 401 and bad bodies with 400', async () => {
    const body = JSON.stringify({ providerEventId: 'evt_x', paymentId: 'nope', kind: 'PAYMENT_SUCCEEDED', amountMinor: 1 });
    expect((await handlePaymentWebhook(services, body, 'sha256=00', meta())).status).toBe(401);
    expect((await handlePaymentWebhook(services, body, undefined, meta())).status).toBe(401);
    const signed = signWebhookBody(body, services.config.paymentWebhookSecret);
    expect(await handlePaymentWebhook(services, body, signed, meta())).toEqual({ status: 400, body: { error: 'Invalid payment notification.' } });
    expect((await handlePaymentWebhook(services, '{not json', signWebhookBody('{not json', services.config.paymentWebhookSecret), meta())).status).toBe(400);
    const unknown = JSON.stringify({ providerEventId: 'evt_y', paymentId: '00000000-0000-4000-8000-000000000999', kind: 'PAYMENT_SUCCEEDED', amountMinor: 1 });
    expect((await handlePaymentWebhook(services, unknown, signWebhookBody(unknown, services.config.paymentWebhookSecret), meta())).status).toBe(400);
  });
});

describe('expiry and races', () => {
  it('expiry cancels an unpaid order and releases its holds', async () => {
    const sku = await createSku(services, base, { east: 5 });
    const order = await placeOrder(services, base.customer, [{ sku, quantity: 2 }]);
    expect(await expireOrderReservations(services, order.orderId, meta())).toEqual({ expired: false });
    await expireNow(order.orderId);
    expect(await expireOrderReservations(services, order.orderId, meta())).toEqual({ expired: true });
    expect(await expireOrderReservations(services, order.orderId, meta())).toEqual({ expired: false });
    expect(await orderState(services, order.orderId)).toMatchObject({ status: 'CANCELLED', reason: 'RESERVATION_EXPIRED' });
    expect(await balance(services, sku.skuId, WAREHOUSE_EAST)).toEqual({ onHand: 5, reserved: 0 });
  });

  it('a payment after expires_at but before expiry runs still wins', async () => {
    const sku = await createSku(services, base, { east: 5 });
    const order = await placeOrder(services, base.customer, [{ sku, quantity: 1 }]);
    await expireNow(order.orderId);
    await recordPaymentNotification(services, succeeded(order, 'evt_late_ok'), meta());
    expect(await expireOrderReservations(services, order.orderId, meta())).toEqual({ expired: false });
    expect(await orderState(services, order.orderId)).toMatchObject({ status: 'CONFIRMED', payment: 'CAPTURED' });
  });

  it('S5: payment confirmation races with expiration (20 iterations)', async () => {
    const sku = await createSku(services, base, { east: 100 });
    const winners = { payment: 0, expiry: 0 };
    for (let i = 0; i < 20; i += 1) {
      const order = await placeOrder(services, base.customer, [{ sku, quantity: 1 }]);
      await expireNow(order.orderId);
      await Promise.all([
        recordPaymentNotification(services, succeeded(order, `evt_race_${i}`), meta()),
        expireOrderReservations(services, order.orderId, meta()),
      ]);
      const state = await orderState(services, order.orderId);
      const moves = await movementCounts(services, { referenceId: order.orderId });
      expect(moves.RESERVE).toBe(1);
      if (state.status === 'CONFIRMED') {
        winners.payment += 1;
        expect(moves.RELEASE ?? 0).toBe(0);
        expect(await reservationStatuses(services, order.orderId)).toEqual(['CONFIRMED']);
      } else {
        winners.expiry += 1;
        expect(state).toEqual({ status: 'CANCELLED', reason: 'RESERVATION_EXPIRED', payment: 'CAPTURED' });
        expect(moves.RELEASE).toBe(1);
        expect(await scalar<string>(services, `SELECT reason AS value FROM refunds WHERE payment_id = $1`, [order.paymentId])).toBe('LATE_PAYMENT');
      }
      const current = await balance(services, sku.skuId, WAREHOUSE_EAST);
      expect(current.reserved).toBeGreaterThanOrEqual(0);
    }
    expect(winners.payment + winners.expiry).toBe(20);
  });

  it('late payment after expiry is captured and fully refunded by the worker', async () => {
    const sku = await createSku(services, base, { east: 5, priceMinor: 1234 });
    const order = await placeOrder(services, base.customer, [{ sku, quantity: 2 }]);
    await expireNow(order.orderId);
    await expireOrderReservations(services, order.orderId, meta());
    await recordPaymentNotification(services, succeeded(order, 'evt_late_refund'), meta());
    await runWorkerUntilIdle(services, { jobIds: await jobIdsForRefunds() });
    expect(await orderState(services, order.orderId)).toEqual({ status: 'CANCELLED', reason: 'RESERVATION_EXPIRED', payment: 'REFUNDED' });
    expect(await scalar<number>(services, 'SELECT refunded_minor AS value FROM payments WHERE id = $1', [order.paymentId])).toBe(2468);
  });
});

async function jobIdsForRefunds(): Promise<string[]> {
  const result = await services.db.query<{ id: string }>(`SELECT id::text AS id FROM outbox_events WHERE topic = 'refund.process'`);
  return result.rows.map((r) => r.id);
}

describe('cancellation', () => {
  it('the owner cancels a confirmed order: stock released, payment refunded', async () => {
    const sku = await createSku(services, base, { east: 5 });
    const order = await placeOrder(services, base.customer, [{ sku, quantity: 2 }]);
    await authorize(services, order);
    expect(await cancelOrder(services, base.customer, order.orderId, meta())).toEqual({ kind: 'cancelled', orderId: order.orderId });
    expect(await cancelOrder(services, base.customer, order.orderId, meta())).toEqual({ kind: 'not_cancellable', status: 'CANCELLED' });
    expect(await balance(services, sku.skuId, WAREHOUSE_EAST)).toEqual({ onHand: 5, reserved: 0 });
    await runWorkerUntilIdle(services, { jobIds: await jobIdsForRefunds() });
    expect(await orderState(services, order.orderId)).toEqual({ status: 'CANCELLED', reason: 'CUSTOMER_REQUEST', payment: 'REFUNDED' });
  });

  it('another customer gets NOT_FOUND; an operator cancel is audited', async () => {
    const sku = await createSku(services, base, { east: 5 });
    const order = await placeOrder(services, base.customer, [{ sku, quantity: 1 }]);
    await expect(cancelOrder(services, base.customer2, order.orderId, meta())).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await cancelOrder(services, base.operator, order.orderId, meta());
    expect(await orderState(services, order.orderId)).toMatchObject({ status: 'CANCELLED', reason: 'OPERATOR_REQUEST' });
    expect(await scalar<string>(services, `SELECT action AS value FROM audit_log WHERE entity_id = $1`, [order.orderId])).toBe('order.cancelled');

    // Payment success after the cancel: captured, then refunded (LATE_PAYMENT).
    await authorize(services, order);
    expect(await jobIdsFor(services, 'refund.process', await scalar<string>(services, 'SELECT id::text AS value FROM refunds'))).toHaveLength(1);
  });
});
