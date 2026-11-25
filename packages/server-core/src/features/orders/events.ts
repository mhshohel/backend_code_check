import type { Tx } from '../../db/db';

export const ORDER_EVENTS_CHANNEL = 'order_events';

/**
 * Records an order change: an order.changed outbox row (metrics/audit) and a
 * pg_notify hint for live subscribers. Both run in the caller's transaction,
 * so PostgreSQL delivers the notification only if the change commits.
 */
export async function recordOrderChanged(
  tx: Tx,
  orderId: string,
  change: { status: string; reason?: string },
  correlationId: string | null,
): Promise<void> {
  await tx.query(
    `WITH event AS (
       INSERT INTO outbox_events (topic, aggregate_type, aggregate_id, payload, correlation_id)
       VALUES ('order.changed', 'order', $1, $2, $3)
     )
     SELECT pg_notify('${ORDER_EVENTS_CHANNEL}', $1)`,
    [orderId, JSON.stringify(change), correlationId],
  );
}
