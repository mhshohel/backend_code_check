import type { CancellationReason, OrderStatus, PaymentStatus, ReservationStatus, ReturnStatus } from '@ofl/domain';
import type { Queryable, Tx } from '../../db/db';

export type OrderRecord = {
  id: string;
  number: number;
  customerId: string;
  status: OrderStatus;
  cancellationReason: CancellationReason | null;
  subtotalMinor: number;
  totalMinor: number;
  reservationExpiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

export const ORDER_COLUMNS = `o.id, o.number, o.customer_id AS "customerId", o.status, o.cancellation_reason AS "cancellationReason",
  o.subtotal_minor AS "subtotalMinor", o.total_minor AS "totalMinor", o.reservation_expires_at AS "reservationExpiresAt",
  o.created_at AS "createdAt", o.updated_at AS "updatedAt"`;

export type OrderLineRecord = {
  id: string;
  orderId: string;
  lineNumber: number;
  skuId: string;
  productName: string;
  skuCode: string;
  quantity: number;
  unitPriceMinor: number;
  lineTotalMinor: number;
};

export const ORDER_LINE_COLUMNS = `l.id, l.order_id AS "orderId", l.line_number AS "lineNumber", l.sku_id AS "skuId",
  l.product_name AS "productName", l.sku_code AS "skuCode", l.quantity, l.unit_price_minor AS "unitPriceMinor",
  l.line_total_minor AS "lineTotalMinor"`;

export type ReservationRecord = {
  id: string;
  orderId: string;
  orderLineId: string;
  skuId: string;
  warehouseId: string;
  quantity: number;
  status: ReservationStatus;
  expiresAt: Date;
};

export const RESERVATION_COLUMNS = `r.id, r.order_id AS "orderId", r.order_line_id AS "orderLineId", r.sku_id AS "skuId",
  r.warehouse_id AS "warehouseId", r.quantity, r.status, r.expires_at AS "expiresAt"`;

export type PaymentRecord = {
  id: string;
  orderId: string;
  status: PaymentStatus;
  amountMinor: number;
  refundedMinor: number;
  declineReason: string | null;
  paymentToken: string;
};

export const PAYMENT_COLUMNS = `p.id, p.order_id AS "orderId", p.status, p.amount_minor AS "amountMinor",
  p.refunded_minor AS "refundedMinor", p.decline_reason AS "declineReason", p.payment_token AS "paymentToken"`;

export type ShipmentRecord = { id: string; orderId: string; warehouseId: string; trackingCode: string; shippedAt: Date };

export const SHIPMENT_COLUMNS = `s.id, s.order_id AS "orderId", s.warehouse_id AS "warehouseId", s.tracking_code AS "trackingCode",
  s.shipped_at AS "shippedAt"`;

export type ShipmentLineRecord = { shipmentId: string; orderLineId: string; quantity: number; skuCode: string };

export type ReturnRecord = {
  id: string;
  orderId: string;
  status: ReturnStatus;
  reason: string;
  refundMinor: number;
  createdAt: Date;
  receivedAt: Date | null;
  refundedAt: Date | null;
};

export const RETURN_COLUMNS = `rt.id, rt.order_id AS "orderId", rt.status, rt.reason, rt.refund_minor AS "refundMinor",
  rt.created_at AS "createdAt", rt.received_at AS "receivedAt", rt.refunded_at AS "refundedAt"`;

export type ReturnLineRecord = { returnId: string; orderLineId: string; warehouseId: string; quantity: number; skuCode: string };

export async function findOrder(db: Queryable, orderId: string): Promise<OrderRecord | null> {
  const result = await db.query<OrderRecord>(`SELECT ${ORDER_COLUMNS} FROM orders o WHERE o.id = $1`, [orderId]);
  return result.rows[0] ?? null;
}

/** Every workflow that changes an order takes this lock first (see requirements §6.4). */
export async function lockOrder(tx: Tx, orderId: string): Promise<OrderRecord | null> {
  const result = await tx.query<OrderRecord>(`SELECT ${ORDER_COLUMNS} FROM orders o WHERE o.id = $1 FOR UPDATE`, [orderId]);
  return result.rows[0] ?? null;
}

export async function findPaymentForOrder(db: Queryable, orderId: string): Promise<PaymentRecord | null> {
  const result = await db.query<PaymentRecord>(`SELECT ${PAYMENT_COLUMNS} FROM payments p WHERE p.order_id = $1`, [orderId]);
  return result.rows[0] ?? null;
}

export async function updateOrderStatus(
  tx: Tx,
  orderId: string,
  status: OrderStatus,
  cancellationReason: CancellationReason | null = null,
): Promise<void> {
  await tx.query('UPDATE orders SET status = $2, cancellation_reason = $3, updated_at = now() WHERE id = $1', [
    orderId,
    status,
    cancellationReason,
  ]);
}
