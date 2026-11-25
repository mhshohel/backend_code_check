import type { Tx } from '../../db/db';
import { enqueueEvents } from '../../outbox/outbox';

export type RefundReason = 'RETURN' | 'CANCELLATION' | 'LATE_PAYMENT';

/**
 * Creates a PENDING refund and its refund.process job. Unique indexes allow
 * one refund per return and one non-return refund per payment, so a repeated
 * call returns null instead of refunding twice.
 */
export async function createRefund(
  tx: Tx,
  input: { paymentId: string; amountMinor: number; reason: RefundReason; returnId?: string | null; correlationId: string | null },
): Promise<string | null> {
  if (input.amountMinor <= 0) return null;
  const inserted = await tx.query<{ id: string }>(
    `INSERT INTO refunds (payment_id, return_id, reason, amount_minor, status)
     VALUES ($1, $2, $3, $4, 'PENDING')
     ON CONFLICT DO NOTHING RETURNING id`,
    [input.paymentId, input.returnId ?? null, input.reason, input.amountMinor],
  );
  const refundId = inserted.rows[0]?.id;
  if (!refundId) return null;
  await enqueueEvents(tx, [
    {
      topic: 'refund.process',
      aggregateType: 'refund',
      aggregateId: refundId,
      payload: { refundId, paymentId: input.paymentId, ...(input.returnId ? { returnId: input.returnId } : {}) },
      correlationId: input.correlationId,
    },
  ]);
  return refundId;
}
