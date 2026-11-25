import { badInput, forbidden, isStaff, uuidSchema, type OrderStatus } from '@ofl/domain';
import type { Queryable } from '../../db/db';
import { timestampCursorSql, toPage, type Page, type PageRequest } from '../../db/pagination';
import { requireViewer } from '../auth/guards';
import type { SessionUser } from '../auth/sessions';
import { ORDER_COLUMNS, type OrderRecord } from './records';

export type OrderListFilter = {
  status?: readonly OrderStatus[] | null;
  awaitingShipmentFromWarehouseId?: string | null;
  withReturnsAwaitingReceipt?: boolean | null;
};

type OrderPageRow = OrderRecord & { cursorKey: string };

const CURSOR_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

/**
 * Newest first, keyset on (created_at, id). Uses orders_customer_created_idx
 * for one customer and orders_status_created_idx / a scan for staff lists.
 */
async function listOrders(db: Queryable, customerId: string | null, filter: OrderListFilter, page: PageRequest): Promise<Page<OrderRecord>> {
  if (page.after && (!CURSOR_TIMESTAMP.test(page.after.sortKey) || !uuidSchema.safeParse(page.after.id).success)) {
    throw badInput('The cursor is not valid.', [{ path: 'after', message: 'Invalid cursor.' }]);
  }
  const result = await db.query<OrderPageRow>(
    `SELECT ${ORDER_COLUMNS}, ${timestampCursorSql('o.created_at')} AS "cursorKey"
     FROM orders o
     WHERE ($1::uuid IS NULL OR o.customer_id = $1)
       AND ($2::text[] IS NULL OR o.status = ANY($2::text[]))
       AND ($3::uuid IS NULL OR EXISTS (
             SELECT 1 FROM reservations r WHERE r.order_id = o.id AND r.warehouse_id = $3 AND r.status = 'CONFIRMED'))
       AND (NOT $4::boolean OR EXISTS (SELECT 1 FROM returns rt WHERE rt.order_id = o.id AND rt.status = 'REQUESTED'))
       AND ($5::timestamptz IS NULL OR (o.created_at, o.id) < ($5::timestamptz, $6::uuid))
     ORDER BY o.created_at DESC, o.id DESC
     LIMIT $7`,
    [
      customerId,
      filter.status && filter.status.length > 0 ? [...filter.status] : null,
      filter.awaitingShipmentFromWarehouseId ?? null,
      filter.withReturnsAwaitingReceipt ?? false,
      page.after?.sortKey ?? null,
      page.after?.id ?? null,
      page.limit + 1,
    ],
  );
  return toPage(result.rows, page.limit, (row) => ({ sortKey: row.cursorKey, id: row.id }));
}

export async function listMyOrders(db: Queryable, viewer: SessionUser | null, filter: OrderListFilter, page: PageRequest): Promise<Page<OrderRecord>> {
  const user = requireViewer(viewer);
  if ((filter.awaitingShipmentFromWarehouseId || filter.withReturnsAwaitingReceipt) && !isStaff(user.role)) throw forbidden();
  return listOrders(db, user.id, filter, page);
}

export async function listAllOrders(db: Queryable, viewer: SessionUser | null, filter: OrderListFilter, page: PageRequest): Promise<Page<OrderRecord>> {
  const user = requireViewer(viewer);
  if (!isStaff(user.role)) throw forbidden();
  return listOrders(db, null, filter, page);
}
