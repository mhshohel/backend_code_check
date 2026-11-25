import { randomBytes } from 'node:crypto';
import { notFound, orderStatusAfterShipment, parseInput, shipOrderInputSchema, type OrderStatus } from '@ofl/domain';
import type { Services } from '../../services';
import { requireStaff } from '../auth/guards';
import type { RequestMeta, SessionUser } from '../auth/sessions';
import { enqueueSearchUpdateForSkus } from '../catalog/search-events';
import { applyStockChanges, lockBalancesForSkus } from '../inventory/ledger';
import { recordOrderChanged } from '../orders/events';
import { assertReservationTransitions, lockOrder, RESERVATION_COLUMNS, updateOrderStatus, type ReservationRecord } from '../orders/records';

export type ShipOrderOutcome =
  | { kind: 'shipped'; shipmentId: string; orderId: string }
  | { kind: 'nothing_to_ship' }
  | { kind: 'not_shippable'; status: OrderStatus };

/** Operator. Ships every confirmed reservation of the order in one warehouse (requirements §6.6). */
export async function shipOrder(services: Services, viewer: SessionUser | null, input: unknown, meta: RequestMeta): Promise<ShipOrderOutcome> {
  const operator = requireStaff(viewer);
  const request = parseInput(shipOrderInputSchema, input);

  return services.db.transaction(async (tx) => {
    const order = await lockOrder(tx, request.orderId);
    if (!order) throw notFound('Order');
    if (order.status !== 'CONFIRMED' && order.status !== 'PARTIALLY_SHIPPED') {
      return { kind: 'not_shippable', status: order.status };
    }

    const confirmed = await tx.query<ReservationRecord>(
      `SELECT ${RESERVATION_COLUMNS} FROM reservations r
       WHERE r.order_id = $1 AND r.warehouse_id = $2 AND r.status = 'CONFIRMED'
       ORDER BY r.sku_id FOR UPDATE`,
      [order.id, request.warehouseId],
    );
    if (confirmed.rows.length === 0) return { kind: 'nothing_to_ship' };
    assertReservationTransitions(confirmed.rows, 'SHIPPED');

    // UNIQUE (order_id, warehouse_id): a second shipment from the same
    // warehouse cannot exist even if the status checks above were bypassed.
    const shipment = await tx.query<{ id: string }>(
      `INSERT INTO shipments (order_id, warehouse_id, tracking_code, shipped_by)
       VALUES ($1, $2, $3, $4) ON CONFLICT (order_id, warehouse_id) DO NOTHING RETURNING id`,
      [order.id, request.warehouseId, request.trackingCode ?? generateTrackingCode(), operator.id],
    );
    const shipmentId = shipment.rows[0]?.id;
    if (!shipmentId) return { kind: 'nothing_to_ship' };

    await tx.query(
      `INSERT INTO shipment_lines (shipment_id, order_line_id, quantity)
       SELECT $1, order_line_id, sum(quantity)::int FROM unnest($2::uuid[], $3::int[]) AS r(order_line_id, quantity)
       GROUP BY order_line_id`,
      [shipmentId, confirmed.rows.map((r) => r.orderLineId), confirmed.rows.map((r) => r.quantity)],
    );
    await lockBalancesForSkus(
      tx,
      confirmed.rows.map((r) => r.skuId),
    );
    await applyStockChanges(
      tx,
      confirmed.rows.map((r) => ({
        skuId: r.skuId,
        warehouseId: r.warehouseId,
        kind: 'SHIP' as const,
        onHandDelta: -r.quantity,
        reservedDelta: -r.quantity,
        referenceType: 'shipment' as const,
        referenceId: shipmentId,
        actorUserId: operator.id,
      })),
    );
    await tx.query(`UPDATE reservations SET status = 'SHIPPED', updated_at = now() WHERE id = ANY($1::uuid[])`, [
      confirmed.rows.map((r) => r.id),
    ]);

    const remaining = await tx.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM reservations WHERE order_id = $1 AND status = 'CONFIRMED'`,
      [order.id],
    );
    const status = orderStatusAfterShipment(remaining.rows[0]?.count ?? 0);
    await updateOrderStatus(tx, order, status);
    await enqueueSearchUpdateForSkus(
      tx,
      confirmed.rows.map((r) => r.skuId),
      meta.correlationId,
    );
    await recordOrderChanged(tx, order.id, { status }, meta.correlationId);
    return { kind: 'shipped', shipmentId, orderId: order.id };
  });
}

function generateTrackingCode(): string {
  return `TRK-${randomBytes(6).toString('hex').toUpperCase()}`;
}
