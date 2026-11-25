import { assertTransition, PAYMENT_TRANSITIONS, paymentStatusAfterRefund, RETURN_TRANSITIONS, type ReturnStatus } from '@ofl/domain';
import type { Services } from '../../services';
import type { RequestMeta } from '../auth/sessions';
import { recordOrderChanged } from '../orders/events';
import { lockOrder, PAYMENT_COLUMNS, type PaymentRecord } from '../orders/records';
import { gatewayCharge, gatewayRefund } from './gateway';
import { recordPaymentNotification } from './notifications';

export type SideEffectHook = () => Promise<void>;

export type AuthorizeOutcome = { kind: 'done' } | { kind: 'reschedule'; availableAt: Date };

/**
 * payment.authorize: charge the simulated gateway (idempotent by payment id),
 * then apply the result through recordPaymentNotification, the same path as
 * the HTTP webhook. `afterSideEffect` lets tests simulate a crash in between.
 */
export async function authorizePayment(
  services: Services,
  paymentId: string,
  meta: RequestMeta,
  afterSideEffect: SideEffectHook,
): Promise<AuthorizeOutcome> {
  const loaded = await services.db.query<PaymentRecord & { reservationExpiresAt: Date }>(
    `SELECT ${PAYMENT_COLUMNS}, o.reservation_expires_at AS "reservationExpiresAt"
     FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.id = $1`,
    [paymentId],
  );
  const payment = loaded.rows[0];
  if (!payment || payment.status !== 'PENDING') return { kind: 'done' };

  // tok_slow_approve answers after the hold time, so the UI can show the
  // expiry race. The job is simply delayed; no worker sleeps.
  if (payment.paymentToken === 'tok_slow_approve') {
    const answerAt = new Date(payment.reservationExpiresAt.getTime() + 5_000);
    if (services.clock.now() < answerAt) return { kind: 'reschedule', availableAt: answerAt };
  }

  const charge = await gatewayCharge(services.db, {
    idempotencyKey: payment.id,
    amountMinor: payment.amountMinor,
    paymentToken: payment.paymentToken,
  });
  await afterSideEffect();
  await recordPaymentNotification(
    services,
    {
      providerEventId: charge.providerEventId,
      paymentId: payment.id,
      kind: charge.outcome === 'APPROVED' ? 'PAYMENT_SUCCEEDED' : 'PAYMENT_DECLINED',
      amountMinor: charge.amountMinor,
      declineReason: charge.declineReason,
    },
    meta,
  );
  return { kind: 'done' };
}

type RefundRow = {
  id: string;
  paymentId: string;
  orderId: string;
  returnId: string | null;
  amountMinor: number;
  status: 'PENDING' | 'SUCCEEDED';
};

/** refund.process: gateway refund (idempotent by refund id), then mark the refund once. */
export async function processRefund(services: Services, refundId: string, meta: RequestMeta, afterSideEffect: SideEffectHook): Promise<void> {
  const refund = await findRefund(services, refundId);
  if (!refund || refund.status === 'SUCCEEDED') return;

  const result = await gatewayRefund(services.db, { idempotencyKey: refund.id, amountMinor: refund.amountMinor });
  await afterSideEffect();

  await services.db.transaction(async (tx) => {
    await lockOrder(tx, refund.orderId);
    const locked = await tx.query<{ status: string }>('SELECT status FROM refunds WHERE id = $1 FOR UPDATE', [refund.id]);
    if (locked.rows[0]?.status !== 'PENDING') return;

    await tx.query('UPDATE refunds SET status = $2, completed_at = $3 WHERE id = $1', [refund.id, 'SUCCEEDED', services.clock.now()]);
    const paymentResult = await tx.query<PaymentRecord>(`SELECT ${PAYMENT_COLUMNS} FROM payments p WHERE p.id = $1`, [refund.paymentId]);
    const payment = paymentResult.rows[0];
    if (!payment) throw new Error(`Payment ${refund.paymentId} of refund ${refund.id} is missing.`);
    const refundedMinor = payment.refundedMinor + refund.amountMinor;
    const nextStatus = paymentStatusAfterRefund(payment.amountMinor, refundedMinor);
    assertTransition('Payment', PAYMENT_TRANSITIONS, payment.status, nextStatus);
    await tx.query('UPDATE payments SET refunded_minor = $2, status = $3, updated_at = now() WHERE id = $1', [
      payment.id,
      refundedMinor,
      nextStatus,
    ]);
    await tx.query(
      `INSERT INTO payment_events (payment_id, provider_event_id, kind, amount_minor, outcome)
       VALUES ($1, $2, 'REFUND_SUCCEEDED', $3, 'refunded') ON CONFLICT (provider_event_id) DO NOTHING`,
      [payment.id, result.providerEventId, refund.amountMinor],
    );
    if (refund.returnId) {
      const current = await tx.query<{ status: ReturnStatus }>('SELECT status FROM returns WHERE id = $1 FOR UPDATE', [refund.returnId]);
      const status = current.rows[0]?.status;
      if (status) {
        assertTransition('Return', RETURN_TRANSITIONS, status, 'REFUNDED');
        await tx.query(`UPDATE returns SET status = 'REFUNDED', refunded_at = $2 WHERE id = $1`, [refund.returnId, services.clock.now()]);
      }
    }
    await recordOrderChanged(tx, refund.orderId, { status: 'REFUNDED', reason: 'REFUND_SUCCEEDED' }, meta.correlationId);
  });
}

async function findRefund(services: Services, refundId: string): Promise<RefundRow | null> {
  const result = await services.db.query<RefundRow>(
    `SELECT r.id, r.payment_id AS "paymentId", p.order_id AS "orderId", r.return_id AS "returnId",
            r.amount_minor AS "amountMinor", r.status
     FROM refunds r JOIN payments p ON p.id = r.payment_id WHERE r.id = $1`,
    [refundId],
  );
  return result.rows[0] ?? null;
}
