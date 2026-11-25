import { checkout } from '../../src/features/checkout/operations';
import type { Services } from '../../src/services';
import { runWorkerUntilIdle } from '../../src/worker/worker';
import { idempotencyKey, meta, type TestSku, type TestUser } from './harness';

export type PlacedOrder = { orderId: string; paymentId: string; amountMinor: number };

export async function placeOrder(
  services: Services,
  customer: TestUser,
  lines: readonly { sku: TestSku; quantity: number }[],
  paymentToken: 'tok_approve' | 'tok_decline' | 'tok_slow_approve' = 'tok_approve',
): Promise<PlacedOrder> {
  const outcome = await checkout(
    services,
    customer,
    {
      idempotencyKey: idempotencyKey(),
      paymentToken,
      lines: lines.map((l) => ({ skuId: l.sku.skuId, quantity: l.quantity, expectedUnitPriceMinor: l.sku.priceMinor })),
    },
    meta(),
  );
  if (outcome.kind !== 'succeeded') throw new Error(`Checkout failed: ${outcome.kind}`);
  const payment = await services.db.query<{ id: string; amount: number }>('SELECT id, amount_minor AS amount FROM payments WHERE order_id = $1', [
    outcome.orderId,
  ]);
  const row = payment.rows[0];
  if (!row) throw new Error('No payment row.');
  return { orderId: outcome.orderId, paymentId: row.id, amountMinor: row.amount };
}

export async function jobIdsFor(services: Services, topic: string, aggregateId: string): Promise<string[]> {
  const result = await services.db.query<{ id: string }>(
    `SELECT id::text AS id FROM outbox_events WHERE topic = $1 AND aggregate_id = $2 ORDER BY id`,
    [topic, aggregateId],
  );
  return result.rows.map((r) => r.id);
}

/** Runs the payment.authorize job of one order (and only it). */
export async function authorize(services: Services, order: PlacedOrder): Promise<void> {
  await runWorkerUntilIdle(services, { jobIds: await jobIdsFor(services, 'payment.authorize', order.orderId) });
}

export async function orderState(services: Services, orderId: string): Promise<{ status: string; reason: string | null; payment: string }> {
  const result = await services.db.query<{ status: string; reason: string | null; payment: string }>(
    `SELECT o.status, o.cancellation_reason AS reason, p.status AS payment FROM orders o JOIN payments p ON p.order_id = o.id WHERE o.id = $1`,
    [orderId],
  );
  const row = result.rows[0];
  if (!row) throw new Error('Order not found.');
  return row;
}

export async function reservationStatuses(services: Services, orderId: string): Promise<string[]> {
  const result = await services.db.query<{ status: string }>('SELECT status FROM reservations WHERE order_id = $1 ORDER BY id', [orderId]);
  return result.rows.map((r) => r.status);
}
