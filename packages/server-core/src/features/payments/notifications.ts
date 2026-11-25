import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { assertTransition, badInput, isAppError, notFound, PAYMENT_TRANSITIONS, uuidSchema, type PaymentStatus } from '@ofl/domain';
import type { Tx } from '../../db/db';
import type { Services } from '../../services';
import type { RequestMeta } from '../auth/sessions';
import { enqueueSearchUpdateForSkus } from '../catalog/search-events';
import { recordOrderChanged } from '../orders/events';
import { lockOrder, PAYMENT_COLUMNS, type OrderRecord, type PaymentRecord } from '../orders/records';
import { releaseOrderReservations } from '../orders/reservations';
import { createRefund } from './refunds';

export type PaymentNotification = {
  providerEventId: string;
  paymentId: string;
  kind: 'PAYMENT_SUCCEEDED' | 'PAYMENT_DECLINED';
  amountMinor: number;
  declineReason?: string | null;
};

export const paymentNotificationSchema = z.object({
  providerEventId: z.string().trim().min(3).max(200),
  paymentId: uuidSchema,
  kind: z.enum(['PAYMENT_SUCCEEDED', 'PAYMENT_DECLINED']),
  amountMinor: z.number().int().min(0),
});

type Outcome =
  | 'captured'
  | 'captured_late_refund'
  | 'declined'
  | 'declined_after_cancel'
  | 'ignored_payment_not_pending'
  | 'ignored_order_state';

/**
 * Applies a provider notification. The order row lock decides races with
 * expiry and cancellation (requirements §6.4). The payment_events insert
 * with a unique provider_event_id turns duplicate deliveries into no-ops.
 */
export async function recordPaymentNotification(
  services: Services,
  notification: PaymentNotification,
  meta: RequestMeta,
): Promise<{ outcome: 'processed' | 'duplicate' }> {
  const parsed = paymentNotificationSchema.safeParse(notification);
  if (!parsed.success) throw badInput('The payment notification is not valid.');

  const result = await services.db.transaction(async (tx) => {
    const orderId = await findOrderIdForPayment(tx, notification.paymentId);
    const order = await lockOrder(tx, orderId);
    if (!order) throw notFound('Payment');
    const payment = await readPayment(tx, notification.paymentId);
    if (notification.amountMinor !== payment.amountMinor) {
      throw badInput('The notification amount does not match the payment.');
    }

    const outcome = decideOutcome(notification.kind, payment.status, order.status);
    const event = await tx.query(
      `INSERT INTO payment_events (payment_id, provider_event_id, kind, amount_minor, outcome)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (provider_event_id) DO NOTHING RETURNING id`,
      [payment.id, notification.providerEventId, notification.kind, notification.amountMinor, outcome],
    );
    if (event.rowCount === 0) return { outcome: 'duplicate' as const, applied: outcome };

    await applyOutcome(tx, outcome, order, payment, notification, meta.correlationId);
    return { outcome: 'processed' as const, applied: outcome };
  });

  services.logger.info(
    { correlationId: meta.correlationId, paymentId: notification.paymentId, result: result.outcome, applied: result.applied },
    'payment notification',
  );
  return { outcome: result.outcome };
}

function decideOutcome(kind: PaymentNotification['kind'], paymentStatus: PaymentStatus, orderStatus: OrderRecord['status']): Outcome {
  // A payment leaves PENDING once. Any later notification (for example the
  // worker's charge after a webhook already confirmed the order) changes nothing.
  if (paymentStatus !== 'PENDING') return 'ignored_payment_not_pending';
  if (kind === 'PAYMENT_SUCCEEDED') {
    if (orderStatus === 'PENDING_PAYMENT') return 'captured';
    if (orderStatus === 'CANCELLED') return 'captured_late_refund';
    return 'ignored_order_state';
  }
  if (orderStatus === 'PENDING_PAYMENT') return 'declined';
  if (orderStatus === 'CANCELLED') return 'declined_after_cancel';
  return 'ignored_order_state';
}

async function applyOutcome(
  tx: Tx,
  outcome: Outcome,
  order: OrderRecord,
  payment: PaymentRecord,
  notification: PaymentNotification,
  correlationId: string,
): Promise<void> {
  switch (outcome) {
    case 'captured': {
      await tx.query(
        `UPDATE reservations SET status = 'CONFIRMED', updated_at = now() WHERE order_id = $1 AND status = 'ACTIVE'`,
        [order.id],
      );
      await setPaymentStatus(tx, payment, 'CAPTURED', null);
      await tx.query(`UPDATE orders SET status = 'CONFIRMED', updated_at = now() WHERE id = $1`, [order.id]);
      await recordOrderChanged(tx, order.id, { status: 'CONFIRMED' }, correlationId);
      return;
    }
    case 'captured_late_refund': {
      await setPaymentStatus(tx, payment, 'CAPTURED', null);
      await createRefund(tx, { paymentId: payment.id, amountMinor: payment.amountMinor, reason: 'LATE_PAYMENT', correlationId });
      await recordOrderChanged(tx, order.id, { status: order.status, reason: 'LATE_PAYMENT' }, correlationId);
      return;
    }
    case 'declined': {
      const released = await releaseOrderReservations(tx, order.id, ['ACTIVE'], 'PAYMENT_DECLINED');
      await setPaymentStatus(tx, payment, 'DECLINED', notification.declineReason ?? 'card_declined');
      await tx.query(
        `UPDATE orders SET status = 'CANCELLED', cancellation_reason = 'PAYMENT_DECLINED', updated_at = now() WHERE id = $1`,
        [order.id],
      );
      await enqueueSearchUpdateForSkus(
        tx,
        released.map((r) => r.skuId),
        correlationId,
      );
      await recordOrderChanged(tx, order.id, { status: 'CANCELLED', reason: 'PAYMENT_DECLINED' }, correlationId);
      return;
    }
    case 'declined_after_cancel': {
      await setPaymentStatus(tx, payment, 'DECLINED', notification.declineReason ?? 'card_declined');
      await recordOrderChanged(tx, order.id, { status: order.status }, correlationId);
      return;
    }
    case 'ignored_payment_not_pending':
    case 'ignored_order_state':
      return;
  }
}

async function setPaymentStatus(tx: Tx, payment: PaymentRecord, status: PaymentStatus, declineReason: string | null): Promise<void> {
  assertTransition('Payment', PAYMENT_TRANSITIONS, payment.status, status);
  await tx.query('UPDATE payments SET status = $2, decline_reason = $3, updated_at = now() WHERE id = $1', [
    payment.id,
    status,
    declineReason,
  ]);
}

async function findOrderIdForPayment(tx: Tx, paymentId: string): Promise<string> {
  const result = await tx.query<{ orderId: string }>('SELECT order_id AS "orderId" FROM payments WHERE id = $1', [paymentId]);
  const row = result.rows[0];
  if (!row) throw notFound('Payment');
  return row.orderId;
}

async function readPayment(tx: Tx, paymentId: string): Promise<PaymentRecord> {
  // The order lock serializes every payment change, so a plain read is consistent here.
  const result = await tx.query<PaymentRecord>(`SELECT ${PAYMENT_COLUMNS} FROM payments p WHERE p.id = $1`, [paymentId]);
  const row = result.rows[0];
  if (!row) throw notFound('Payment');
  return row;
}

// ---------------------------------------------------------------------------
// HTTP webhook (POST /webhooks/payments). Frameworks pass the raw body.
// ---------------------------------------------------------------------------

export function signWebhookBody(rawBody: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
}

function signatureMatches(rawBody: string, header: string | undefined, secret: string): boolean {
  if (!header) return false;
  const expected = Buffer.from(signWebhookBody(rawBody, secret), 'utf8');
  const received = Buffer.from(header.trim(), 'utf8');
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export type WebhookResponse = {
  status: 200 | 400 | 401;
  body: { status: 'processed' | 'duplicate' } | { error: string };
};

export async function handlePaymentWebhook(
  services: Services,
  rawBody: string,
  signatureHeader: string | undefined,
  meta: RequestMeta,
): Promise<WebhookResponse> {
  // Authenticate before parsing: an unsigned body is never interpreted.
  if (!signatureMatches(rawBody, signatureHeader, services.config.paymentWebhookSecret)) {
    services.logger.warn({ correlationId: meta.correlationId, ip: meta.ip }, 'payment webhook rejected: bad signature');
    return { status: 401, body: { error: 'Invalid signature.' } };
  }
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: 'Body must be JSON.' } };
  }
  const parsed = paymentNotificationSchema.safeParse(json);
  if (!parsed.success) return { status: 400, body: { error: 'Invalid payment notification.' } };

  try {
    const result = await recordPaymentNotification(services, parsed.data, meta);
    return { status: 200, body: { status: result.outcome } };
  } catch (error) {
    if (isAppError(error) && (error.code === 'NOT_FOUND' || error.code === 'BAD_USER_INPUT')) {
      return { status: 400, body: { error: error.message } };
    }
    throw error;
  }
}
