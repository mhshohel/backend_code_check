import DataLoader from 'dataloader';
import type { Queryable } from '../db/db';
import type { SessionUser } from '../features/auth/sessions';
import { PRODUCT_COLUMNS, SKU_COLUMNS, type CategoryRecord, type ProductRecord, type SkuRecord, type WarehouseRecord } from '../features/catalog/records';
import { BALANCE_COLUMNS, type BalanceRecord } from '../features/inventory/queries';
import {
  ORDER_LINE_COLUMNS,
  PAYMENT_COLUMNS,
  RESERVATION_COLUMNS,
  RETURN_COLUMNS,
  SHIPMENT_COLUMNS,
  type OrderLineRecord,
  type PaymentRecord,
  type ReservationRecord,
  type ReturnLineRecord,
  type ReturnRecord,
  type ShipmentLineRecord,
  type ShipmentRecord,
} from '../features/orders/records';

// Request-scoped batch loaders. Every nested field of a list resolves
// through one of these, so a page of N orders costs a fixed number of
// queries (one per relation), not N per relation.

type Keyed = Record<string, unknown>;

function byKey<R extends Keyed>(rows: readonly R[], key: keyof R & string): Map<string, R> {
  return new Map(rows.map((row) => [String(row[key]), row]));
}

function groupBy<R extends Keyed>(rows: readonly R[], key: keyof R & string): Map<string, R[]> {
  const groups = new Map<string, R[]>();
  for (const row of rows) {
    const id = String(row[key]);
    const list = groups.get(id) ?? [];
    list.push(row);
    groups.set(id, list);
  }
  return groups;
}

function oneLoader<R extends Keyed>(db: Queryable, sql: string, key: keyof R & string): DataLoader<string, R | null> {
  return new DataLoader<string, R | null>(async (ids) => {
    const rows = (await db.query<R>(sql, [[...ids]])).rows;
    const map = byKey(rows, key);
    return ids.map((id) => map.get(id) ?? null);
  });
}

function manyLoader<R extends Keyed>(db: Queryable, sql: string, key: keyof R & string): DataLoader<string, R[]> {
  return new DataLoader<string, R[]>(async (ids) => {
    const rows = (await db.query<R>(sql, [[...ids]])).rows;
    const groups = groupBy(rows, key);
    return ids.map((id) => groups.get(id) ?? []);
  });
}

function sumLoader(db: Queryable, sql: string): DataLoader<string, number> {
  return new DataLoader<string, number>(async (ids) => {
    const rows = (await db.query<{ id: string; total: number }>(sql, [[...ids]])).rows;
    const totals = new Map(rows.map((row) => [row.id, row.total]));
    return ids.map((id) => totals.get(id) ?? 0);
  });
}

export function createLoaders(db: Queryable) {
  let warehouses: Promise<WarehouseRecord[]> | null = null;
  const allWarehouses = () => {
    warehouses ??= db.query<WarehouseRecord>('SELECT id, code, name, priority FROM warehouses ORDER BY priority').then((r) => r.rows);
    return warehouses;
  };

  return {
    allWarehouses,
    warehouse: new DataLoader<string, WarehouseRecord | null>(async (ids) => {
      const map = byKey(await allWarehouses(), 'id');
      return ids.map((id) => map.get(id) ?? null);
    }),
    user: oneLoader<SessionUser>(
      db,
      'SELECT id, email, display_name AS "displayName", role FROM users WHERE id = ANY($1::uuid[])',
      'id',
    ),
    category: oneLoader<CategoryRecord>(db, 'SELECT id, slug, name FROM categories WHERE id = ANY($1::uuid[])', 'id'),
    product: oneLoader<ProductRecord>(db, `SELECT ${PRODUCT_COLUMNS} FROM products p WHERE p.id = ANY($1::uuid[])`, 'id'),
    sku: oneLoader<SkuRecord>(db, `SELECT ${SKU_COLUMNS} FROM skus s WHERE s.id = ANY($1::uuid[])`, 'id'),
    skusByProduct: manyLoader<SkuRecord>(
      db,
      `SELECT ${SKU_COLUMNS} FROM skus s WHERE s.product_id = ANY($1::uuid[]) AND s.active ORDER BY s.price_minor, s.code`,
      'productId',
    ),
    balancesBySku: manyLoader<BalanceRecord>(
      db,
      `SELECT ${BALANCE_COLUMNS} FROM inventory_balances b JOIN warehouses w ON w.id = b.warehouse_id
       WHERE b.sku_id = ANY($1::uuid[]) ORDER BY w.priority`,
      'skuId',
    ),
    linesByOrder: manyLoader<OrderLineRecord>(
      db,
      `SELECT ${ORDER_LINE_COLUMNS} FROM order_lines l WHERE l.order_id = ANY($1::uuid[]) ORDER BY l.line_number`,
      'orderId',
    ),
    reservationsByOrder: manyLoader<ReservationRecord>(
      db,
      `SELECT ${RESERVATION_COLUMNS} FROM reservations r WHERE r.order_id = ANY($1::uuid[]) ORDER BY r.created_at, r.id`,
      'orderId',
    ),
    paymentByOrder: oneLoader<PaymentRecord>(db, `SELECT ${PAYMENT_COLUMNS} FROM payments p WHERE p.order_id = ANY($1::uuid[])`, 'orderId'),
    shipmentsByOrder: manyLoader<ShipmentRecord>(
      db,
      `SELECT ${SHIPMENT_COLUMNS} FROM shipments s WHERE s.order_id = ANY($1::uuid[]) ORDER BY s.shipped_at, s.id`,
      'orderId',
    ),
    shipmentLines: manyLoader<ShipmentLineRecord>(
      db,
      `SELECT sl.shipment_id AS "shipmentId", sl.order_line_id AS "orderLineId", sl.quantity, l.sku_code AS "skuCode"
       FROM shipment_lines sl JOIN order_lines l ON l.id = sl.order_line_id
       WHERE sl.shipment_id = ANY($1::uuid[]) ORDER BY l.line_number`,
      'shipmentId',
    ),
    returnsByOrder: manyLoader<ReturnRecord>(
      db,
      `SELECT ${RETURN_COLUMNS} FROM returns rt WHERE rt.order_id = ANY($1::uuid[]) ORDER BY rt.created_at, rt.id`,
      'orderId',
    ),
    returnLines: manyLoader<ReturnLineRecord>(
      db,
      `SELECT rl.return_id AS "returnId", rl.order_line_id AS "orderLineId", rl.warehouse_id AS "warehouseId", rl.quantity,
              l.sku_code AS "skuCode"
       FROM return_lines rl JOIN order_lines l ON l.id = rl.order_line_id
       WHERE rl.return_id = ANY($1::uuid[]) ORDER BY l.line_number, rl.warehouse_id`,
      'returnId',
    ),
    shippedQuantityByLine: sumLoader(
      db,
      `SELECT order_line_id AS id, sum(quantity)::int AS total FROM shipment_lines
       WHERE order_line_id = ANY($1::uuid[]) GROUP BY order_line_id`,
    ),
    returnedQuantityByLine: sumLoader(
      db,
      `SELECT order_line_id AS id, sum(quantity)::int AS total FROM return_lines
       WHERE order_line_id = ANY($1::uuid[]) GROUP BY order_line_id`,
    ),
  };
}

export type Loaders = ReturnType<typeof createLoaders>;
