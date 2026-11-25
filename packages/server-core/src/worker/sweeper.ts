import type { Services } from '../services';

/**
 * Safety net for lost or delayed reservation.expire jobs: enqueue one for
 * every order with an overdue ACTIVE hold and no claimable expiry job yet.
 */
export async function enqueueOverdueExpiries(services: Services, limit = 500): Promise<number> {
  const result = await services.db.query(
    `INSERT INTO outbox_events (topic, aggregate_type, aggregate_id, payload, correlation_id)
     SELECT 'reservation.expire', 'order', o.order_id::text, jsonb_build_object('orderId', o.order_id, 'source', 'sweeper'), 'sweeper'
     FROM (
       SELECT DISTINCT r.order_id FROM reservations r
       WHERE r.status = 'ACTIVE' AND r.expires_at <= $1
     ) o
     WHERE NOT EXISTS (
       SELECT 1 FROM outbox_events e
       WHERE e.status IN ('PENDING', 'PROCESSING') AND e.available_at <= $1
         AND e.topic = 'reservation.expire' AND e.aggregate_id = o.order_id::text
     )
     LIMIT $2`,
    [services.clock.now(), limit],
  );
  const count = result.rowCount ?? 0;
  if (count > 0) services.logger.info({ count }, 'sweeper enqueued overdue reservation expiries');
  return count;
}
