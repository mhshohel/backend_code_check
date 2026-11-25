import type { ReservationStatus } from '@ofl/domain';
import type { Tx } from '../../db/db';
import { applyStockChanges, lockBalancesForSkus } from '../inventory/ledger';
import { RESERVATION_COLUMNS, type ReservationRecord } from './records';

/**
 * Releases the order's holds in the given statuses: RELEASE movements,
 * balance updates, reservations RELEASED. The caller holds the order lock,
 * so the status filter cannot race with another release of the same order;
 * the movement uniqueness index (one RELEASE per order, SKU, warehouse) is
 * the second guard.
 */
export async function releaseOrderReservations(
  tx: Tx,
  orderId: string,
  statuses: readonly Extract<ReservationStatus, 'ACTIVE' | 'CONFIRMED'>[],
  releaseReason: string,
): Promise<ReservationRecord[]> {
  const held = await tx.query<ReservationRecord>(
    `SELECT ${RESERVATION_COLUMNS} FROM reservations r WHERE r.order_id = $1 AND r.status = ANY($2::text[])
     ORDER BY r.sku_id, r.warehouse_id`,
    [orderId, [...statuses]],
  );
  if (held.rows.length === 0) return [];

  await lockBalancesForSkus(
    tx,
    held.rows.map((r) => r.skuId),
  );
  await applyStockChanges(
    tx,
    held.rows.map((reservation) => ({
      skuId: reservation.skuId,
      warehouseId: reservation.warehouseId,
      kind: 'RELEASE' as const,
      onHandDelta: 0,
      reservedDelta: -reservation.quantity,
      referenceType: 'order' as const,
      referenceId: orderId,
      reason: releaseReason,
    })),
  );
  await tx.query(
    `UPDATE reservations SET status = 'RELEASED', release_reason = $2, updated_at = now() WHERE id = ANY($1::uuid[])`,
    [held.rows.map((r) => r.id), releaseReason],
  );
  return held.rows;
}
