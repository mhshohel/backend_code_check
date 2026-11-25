import {
  assertTransition,
  checkReturnQuantities,
  RETURN_TRANSITIONS,
  forbidden,
  isReturnableStatus,
  isStaff,
  multiplyMinor,
  notFound,
  parseInput,
  requestReturnInputSchema,
  sumMinor,
  type OrderStatus,
  type ReturnStatus,
} from '@ofl/domain';
import type { Tx } from '../../db/db';
import type { Services } from '../../services';
import { parseEntityId, requireStaff, requireViewer } from '../auth/guards';
import type { RequestMeta, SessionUser } from '../auth/sessions';
import { enqueueSearchUpdateForSkus } from '../catalog/search-events';
import { applyStockChanges, lockBalancesForSkus } from '../inventory/ledger';
import { recordOrderChanged } from '../orders/events';
import { findPaymentForOrder, lockOrder } from '../orders/records';
import { createRefund } from '../payments/refunds';

export type RequestReturnOutcome =
  | { kind: 'requested'; returnId: string; orderId: string }
  | { kind: 'quantity_exceeded'; lines: { orderLineId: string; requested: number; returnable: number }[] }
  | { kind: 'not_returnable'; status: OrderStatus };

type LineState = { orderLineId: string; unitPriceMinor: number; shippedQuantity: number; returnedQuantity: number };
type ShippedFrom = { orderLineId: string; warehouseId: string; shipped: number; returned: number };

/** Owner. Locks the order so concurrent requests see each other's returns (requirements §6.7). */
export async function requestReturn(services: Services, viewer: SessionUser | null, input: unknown, meta: RequestMeta): Promise<RequestReturnOutcome> {
  const user = requireViewer(viewer);
  const request = parseInput(requestReturnInputSchema, input);

  return services.db.transaction(async (tx) => {
    const order = await lockOrder(tx, request.orderId);
    if (!order) throw notFound('Order');
    if (order.customerId !== user.id) {
      if (isStaff(user.role)) throw forbidden();
      throw notFound('Order');
    }
    if (!isReturnableStatus(order.status)) return { kind: 'not_returnable', status: order.status };

    const lines = await loadLineStates(tx, order.id);
    const check = checkReturnQuantities(request.lines, lines);
    if (check.kind === 'exceeded') return { kind: 'quantity_exceeded', lines: check.lines };

    const unitPrice = new Map(lines.map((l) => [l.orderLineId, l.unitPriceMinor]));
    const refundMinor = sumMinor(request.lines.map((l) => multiplyMinor(unitPrice.get(l.orderLineId) ?? 0, l.quantity)));
    const splits = splitByShippingWarehouse(request.lines, await loadShippedFrom(tx, order.id));

    const inserted = await tx.query<{ id: string }>(
      `INSERT INTO returns (order_id, status, reason, refund_minor, requested_by) VALUES ($1, 'REQUESTED', $2, $3, $4) RETURNING id`,
      [order.id, request.reason, refundMinor, user.id],
    );
    const returnId = inserted.rows[0]?.id;
    if (!returnId) throw new Error('Return insert returned no id.');
    await tx.query(
      `INSERT INTO return_lines (return_id, order_line_id, warehouse_id, quantity)
       SELECT $1, * FROM unnest($2::uuid[], $3::uuid[], $4::int[])`,
      [returnId, splits.map((s) => s.orderLineId), splits.map((s) => s.warehouseId), splits.map((s) => s.quantity)],
    );
    await recordOrderChanged(tx, order.id, { status: order.status, reason: 'RETURN_REQUESTED' }, meta.correlationId);
    return { kind: 'requested', returnId, orderId: order.id };
  });
}

async function loadLineStates(tx: Tx, orderId: string): Promise<LineState[]> {
  const result = await tx.query<LineState>(
    `SELECT l.id AS "orderLineId", l.unit_price_minor AS "unitPriceMinor",
            COALESCE((SELECT sum(sl.quantity) FROM shipment_lines sl WHERE sl.order_line_id = l.id), 0)::int AS "shippedQuantity",
            COALESCE((SELECT sum(rl.quantity) FROM return_lines rl WHERE rl.order_line_id = l.id), 0)::int AS "returnedQuantity"
     FROM order_lines l WHERE l.order_id = $1`,
    [orderId],
  );
  return result.rows;
}

async function loadShippedFrom(tx: Tx, orderId: string): Promise<ShippedFrom[]> {
  const result = await tx.query<ShippedFrom>(
    `SELECT sl.order_line_id AS "orderLineId", s.warehouse_id AS "warehouseId", sl.quantity AS shipped,
            COALESCE((SELECT sum(rl.quantity) FROM return_lines rl
                      WHERE rl.order_line_id = sl.order_line_id AND rl.warehouse_id = s.warehouse_id), 0)::int AS returned
     FROM shipments s JOIN shipment_lines sl ON sl.shipment_id = s.id
     WHERE s.order_id = $1
     ORDER BY s.shipped_at, s.id`,
    [orderId],
  );
  return result.rows;
}

/**
 * Splits each requested quantity across the warehouses that shipped the
 * line, earliest shipment first, skipping units that earlier returns
 * already claimed. Returned units go back to the warehouse they left.
 */
export function splitByShippingWarehouse(
  requested: readonly { orderLineId: string; quantity: number }[],
  shippedFrom: readonly ShippedFrom[],
): { orderLineId: string; warehouseId: string; quantity: number }[] {
  const splits: { orderLineId: string; warehouseId: string; quantity: number }[] = [];
  for (const line of requested) {
    let remaining = line.quantity;
    for (const source of shippedFrom.filter((s) => s.orderLineId === line.orderLineId)) {
      if (remaining === 0) break;
      const free = source.shipped - source.returned;
      if (free <= 0) continue;
      const take = Math.min(free, remaining);
      splits.push({ orderLineId: line.orderLineId, warehouseId: source.warehouseId, quantity: take });
      remaining -= take;
    }
    if (remaining > 0) throw new Error('Return split does not cover the requested quantity.');
  }
  return splits;
}

export type ReceiveReturnOutcome =
  | { kind: 'received'; returnId: string; orderId: string }
  | { kind: 'not_receivable'; status: ReturnStatus };

type ReturnLineRow = { orderLineId: string; skuId: string; warehouseId: string; quantity: number };

/** Operator. REQUESTED -> RECEIVED once: restock and start the refund. */
export async function receiveReturn(services: Services, viewer: SessionUser | null, returnIdInput: string, meta: RequestMeta): Promise<ReceiveReturnOutcome> {
  const operator = requireStaff(viewer);
  const returnId = parseEntityId(returnIdInput, 'Return');

  return services.db.transaction(async (tx) => {
    const owner = await tx.query<{ orderId: string }>('SELECT order_id AS "orderId" FROM returns WHERE id = $1', [returnId]);
    const orderId = owner.rows[0]?.orderId;
    if (!orderId) throw notFound('Return');
    await lockOrder(tx, orderId);
    const current = await tx.query<{ status: ReturnStatus; refundMinor: number }>(
      'SELECT status, refund_minor AS "refundMinor" FROM returns WHERE id = $1 FOR UPDATE',
      [returnId],
    );
    const row = current.rows[0];
    if (!row) throw notFound('Return');
    if (row.status !== 'REQUESTED') return { kind: 'not_receivable', status: row.status };
    assertTransition('Return', RETURN_TRANSITIONS, row.status, 'RECEIVED');

    const lines = await tx.query<ReturnLineRow>(
      `SELECT rl.order_line_id AS "orderLineId", l.sku_id AS "skuId", rl.warehouse_id AS "warehouseId", rl.quantity
       FROM return_lines rl JOIN order_lines l ON l.id = rl.order_line_id WHERE rl.return_id = $1`,
      [returnId],
    );
    await lockBalancesForSkus(
      tx,
      lines.rows.map((l) => l.skuId),
    );
    await applyStockChanges(
      tx,
      lines.rows.map((l) => ({
        skuId: l.skuId,
        warehouseId: l.warehouseId,
        kind: 'RETURN_RESTOCK' as const,
        onHandDelta: l.quantity,
        reservedDelta: 0,
        referenceType: 'return' as const,
        referenceId: returnId,
        actorUserId: operator.id,
      })),
    );
    await tx.query(
      `UPDATE returns SET status = 'RECEIVED', received_by = $2, received_at = $3 WHERE id = $1`,
      [returnId, operator.id, services.clock.now()],
    );
    const payment = await findPaymentForOrder(tx, orderId);
    if (payment) {
      await createRefund(tx, {
        paymentId: payment.id,
        amountMinor: row.refundMinor,
        reason: 'RETURN',
        returnId,
        correlationId: meta.correlationId,
      });
    }
    await enqueueSearchUpdateForSkus(
      tx,
      lines.rows.map((l) => l.skuId),
      meta.correlationId,
    );
    await recordOrderChanged(tx, orderId, { status: 'RETURN_RECEIVED' }, meta.correlationId);
    return { kind: 'received', returnId, orderId };
  });
}
