import { isCancellable, isStaff, notFound, type OrderStatus } from '@ofl/domain';
import type { Services } from '../../services';
import { writeAudit } from '../audit/audit';
import { canViewOrder, parseEntityId, requireViewer } from '../auth/guards';
import type { RequestMeta, SessionUser } from '../auth/sessions';
import { enqueueSearchUpdateForSkus } from '../catalog/search-events';
import { createRefund } from '../payments/refunds';
import { recordOrderChanged } from './events';
import { findOrder, findPaymentForOrder, lockOrder, type OrderRecord } from './records';
import { releaseOrderReservations } from './reservations';

export type CancelOrderOutcome =
  | { kind: 'cancelled'; orderId: string }
  | { kind: 'not_cancellable'; status: OrderStatus };

/** Owner or staff. Releases holds, cancels, and refunds a captured payment. */
export async function cancelOrder(
  services: Services,
  viewer: SessionUser | null,
  orderIdInput: string,
  meta: RequestMeta,
): Promise<CancelOrderOutcome> {
  const user = requireViewer(viewer);
  const orderId = parseEntityId(orderIdInput, 'Order');

  return services.db.transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (!order || !canViewOrder(user, order)) throw notFound('Order');

    const shipments = await tx.query<{ count: number }>('SELECT count(*)::int AS count FROM shipments WHERE order_id = $1', [orderId]);
    if (!isCancellable({ status: order.status, shipmentCount: shipments.rows[0]?.count ?? 0 })) {
      return { kind: 'not_cancellable', status: order.status };
    }

    const byOwner = order.customerId === user.id;
    const reason = byOwner && !isStaff(user.role) ? 'CUSTOMER_REQUEST' : 'OPERATOR_REQUEST';
    const released = await releaseOrderReservations(tx, orderId, ['ACTIVE', 'CONFIRMED'], reason);
    await tx.query(`UPDATE orders SET status = 'CANCELLED', cancellation_reason = $2, updated_at = now() WHERE id = $1`, [
      orderId,
      reason,
    ]);

    const payment = await findPaymentForOrder(tx, orderId);
    if (payment && payment.status === 'CAPTURED') {
      await createRefund(tx, {
        paymentId: payment.id,
        amountMinor: payment.amountMinor - payment.refundedMinor,
        reason: 'CANCELLATION',
        correlationId: meta.correlationId,
      });
    }
    if (reason === 'OPERATOR_REQUEST') {
      await writeAudit(tx, {
        actorUserId: user.id,
        action: 'order.cancelled',
        entityType: 'order',
        entityId: orderId,
        details: { previousStatus: order.status, orderNumber: order.number },
        correlationId: meta.correlationId,
      });
    }
    await enqueueSearchUpdateForSkus(
      tx,
      released.map((r) => r.skuId),
      meta.correlationId,
    );
    await recordOrderChanged(tx, orderId, { status: 'CANCELLED', reason }, meta.correlationId);
    return { kind: 'cancelled', orderId };
  });
}

/**
 * The reservation.expire job body. Under the order lock: if the order still
 * waits for payment and its hold has expired, release the holds and cancel.
 * Otherwise (paid, cancelled, or not yet expired) do nothing.
 */
export async function expireOrderReservations(services: Services, orderId: string, meta: RequestMeta): Promise<{ expired: boolean }> {
  return services.db.transaction(async (tx) => {
    const order = await lockOrder(tx, orderId);
    if (!order || order.status !== 'PENDING_PAYMENT') return { expired: false };

    // Normally the order and its reservations share one expiry. Taking the
    // earliest keeps the rule correct if either was moved (support tooling, tests).
    const earliest = await tx.query<{ expiresAt: Date | null }>(
      `SELECT min(expires_at) AS "expiresAt" FROM reservations WHERE order_id = $1 AND status = 'ACTIVE'`,
      [orderId],
    );
    const reservationExpiry = earliest.rows[0]?.expiresAt ?? null;
    const expiresAt =
      reservationExpiry && reservationExpiry < order.reservationExpiresAt ? reservationExpiry : order.reservationExpiresAt;
    if (services.clock.now().getTime() < expiresAt.getTime()) return { expired: false };

    const released = await releaseOrderReservations(tx, orderId, ['ACTIVE'], 'RESERVATION_EXPIRED');
    await tx.query(
      `UPDATE orders SET status = 'CANCELLED', cancellation_reason = 'RESERVATION_EXPIRED', updated_at = now() WHERE id = $1`,
      [orderId],
    );
    await enqueueSearchUpdateForSkus(
      tx,
      released.map((r) => r.skuId),
      meta.correlationId,
    );
    await recordOrderChanged(tx, orderId, { status: 'CANCELLED', reason: 'RESERVATION_EXPIRED' }, meta.correlationId);
    return { expired: true };
  });
}

/** Loads an order the viewer may see. Other customers' orders are NOT_FOUND. */
export async function getOrderForViewer(services: Services, viewer: SessionUser | null, orderIdInput: string): Promise<OrderRecord> {
  const user = requireViewer(viewer);
  const orderId = parseEntityId(orderIdInput, 'Order');
  const order = await findOrder(services.db, orderId);
  if (!order || !canViewOrder(user, order)) throw notFound('Order');
  return order;
}
