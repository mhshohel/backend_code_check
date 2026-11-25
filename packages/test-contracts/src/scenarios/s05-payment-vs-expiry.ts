import { randomUUID } from 'node:crypto';
import { expect, it } from '@jest/globals';
import { CheckoutDocument } from '@ofl/graphql-types';
import { executeOperation, expireOrderReservations, recordPaymentNotification } from '@ofl/server-core';
import { checkoutInput, DEMO_ACCOUNTS, requestMeta } from '../support/context';
import { expectTypename } from '../support/graphql-http';
import type { Scenario } from './types';

const ITERATIONS = 20;
const ORDERS_PER_ITERATION = 2;

export const s05PaymentVersusExpiry: Scenario = (context) => {
  it('S5 payment confirmation races with expiration: exactly one side wins per order', async () => {
    const ctx = context();
    const { east } = ctx.warehouses;
    const sku = await ctx.createSku('RACE', 1000, { east: ITERATIONS * ORDERS_PER_ITERATION });
    const { user } = await ctx.sessionClient(DEMO_ACCOUNTS.customer);
    const outcomes: string[] = [];

    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      const orderIds: string[] = await Promise.all(
        Array.from({ length: ORDERS_PER_ITERATION }, async () => {
          const input = checkoutInput([{ sku, quantity: 1 }], 'tok_approve');
          const data = await executeOperation(ctx.services, user, requestMeta(), CheckoutDocument, { input });
          return expectTypename(data.checkout, 'CheckoutSucceeded').order.id;
        }),
      );
      for (const orderId of orderIds) await ctx.db.expireHold(orderId);

      await Promise.all(
        orderIds.map(async (orderId) => {
          const payment = await ctx.db.payment(orderId);
          await Promise.all([
            recordPaymentNotification(
              ctx.services,
              { providerEventId: `evt_acc_${randomUUID()}`, paymentId: payment.id, kind: 'PAYMENT_SUCCEEDED', amountMinor: payment.amountMinor },
              requestMeta(),
            ),
            expireOrderReservations(ctx.services, orderId, requestMeta()),
          ]);
        }),
      );

      for (const orderId of orderIds) outcomes.push(await verifyRaceOutcome(orderId));
    }

    expect(outcomes).toHaveLength(ITERATIONS * ORDERS_PER_ITERATION);
    const balance = await ctx.db.balance(sku.id, east);
    expect(balance.reserved).toBeGreaterThanOrEqual(0);
    expect(balance.reserved).toBe(outcomes.filter((outcome) => outcome === 'payment-won').length);

    async function verifyRaceOutcome(orderId: string): Promise<'payment-won' | 'expiry-won'> {
      const order = await ctx.db.order(orderId);
      const payment = await ctx.db.payment(orderId);
      const reservationIds = await ctx.db.query<{ id: string }>(`SELECT id FROM reservations WHERE order_id = $1`, [orderId]);
      const releaseCount = await countOrderMovements(orderId, 'RELEASE');
      const reserveCount = await countOrderMovements(orderId, 'RESERVE');
      expect(reserveCount).toBe(reservationIds.length);
      expect(payment.status).toBe('CAPTURED');

      if (order.status === 'CONFIRMED') {
        expect(await ctx.db.reservationStatuses(orderId)).toEqual(['CONFIRMED']);
        expect(releaseCount).toBe(0);
        expect(await ctx.db.refundReasons(payment.id)).toEqual([]);
        return 'payment-won';
      }
      expect(order).toEqual({ status: 'CANCELLED', cancellationReason: 'RESERVATION_EXPIRED' });
      expect(await ctx.db.reservationStatuses(orderId)).toEqual(['RELEASED']);
      expect(releaseCount).toBe(1);
      expect(await ctx.db.refundReasons(payment.id)).toEqual(['LATE_PAYMENT']);
      return 'expiry-won';
    }

    // Reservation movements may reference the order or the reservation; both count.
    async function countOrderMovements(orderId: string, kind: 'RESERVE' | 'RELEASE'): Promise<number> {
      const row = await ctx.db.one<{ count: string }>(
        `SELECT count(*) AS count FROM inventory_movements m
          WHERE m.kind = $3 AND m.sku_id = $2
            AND (m.reference_id = $1 OR m.reference_id IN (SELECT id FROM reservations WHERE order_id = $1))`,
        [orderId, sku.id, kind],
      );
      return Number(row.count);
    }
  }, 120_000);
};
