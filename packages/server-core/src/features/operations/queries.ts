import { badInput, ORDER_STATUSES, type OrderStatus } from '@ofl/domain';
import type { Queryable } from '../../db/db';
import { assertCursorId, toPage, type Page, type PageRequest } from '../../db/pagination';
import { jobColumns, type JobRow, type JobStatus } from '../../outbox/outbox';

export async function countOrdersByStatus(db: Queryable): Promise<{ status: OrderStatus; count: number }[]> {
  const result = await db.query<{ status: OrderStatus; count: number }>(
    'SELECT status, count(*)::int AS count FROM orders GROUP BY status',
  );
  const counts = new Map(result.rows.map((row) => [row.status, row.count]));
  return ORDER_STATUSES.map((status) => ({ status, count: counts.get(status) ?? 0 }));
}

export type DailyRevenueRow = { day: string; orders: number; revenueMinor: number; cumulativeRevenueMinor: number };

/**
 * Revenue per UTC day for captured (or later refunded) payments, with a
 * running total from a window function. Days without orders appear as zero.
 */
export async function dailyRevenue(db: Queryable, days: number, now: Date): Promise<DailyRevenueRow[]> {
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    throw badInput('days must be between 1 and 90.', [{ path: 'days', message: 'Must be between 1 and 90.' }]);
  }
  const result = await db.query<DailyRevenueRow>(
    `WITH window_days AS (
       SELECT generate_series(($1::timestamptz AT TIME ZONE 'UTC')::date - ($2::int - 1), ($1::timestamptz AT TIME ZONE 'UTC')::date, interval '1 day')::date AS day
     ),
     per_day AS (
       SELECT (o.created_at AT TIME ZONE 'UTC')::date AS day, count(*)::int AS orders, sum(p.amount_minor)::bigint AS revenue
       FROM orders o JOIN payments p ON p.order_id = o.id
       WHERE p.status IN ('CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED')
         AND o.created_at >= (($1::timestamptz AT TIME ZONE 'UTC')::date - ($2::int - 1))::timestamp AT TIME ZONE 'UTC'
       GROUP BY 1
     )
     SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
            COALESCE(per_day.orders, 0) AS orders,
            COALESCE(per_day.revenue, 0)::bigint AS "revenueMinor",
            sum(COALESCE(per_day.revenue, 0)) OVER (ORDER BY d.day)::bigint AS "cumulativeRevenueMinor"
     FROM window_days d LEFT JOIN per_day ON per_day.day = d.day
     ORDER BY d.day`,
    [now, days],
  );
  return result.rows;
}

export type LowStockRow = { skuId: string; warehouseId: string; available: number };

export async function lowStock(db: Queryable, threshold: number, limit: number): Promise<LowStockRow[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw badInput('limit must be between 1 and 100.', [{ path: 'limit', message: 'Must be between 1 and 100.' }]);
  }
  const result = await db.query<LowStockRow>(
    `SELECT b.sku_id AS "skuId", b.warehouse_id AS "warehouseId", (b.on_hand - b.reserved) AS available
     FROM inventory_balances b JOIN skus s ON s.id = b.sku_id
     WHERE s.active AND b.on_hand - b.reserved <= $1
     ORDER BY available, s.code, b.warehouse_id LIMIT $2`,
    [threshold, limit],
  );
  return result.rows;
}

export type JobHealth = { pendingJobs: number; failedJobs: number; oldestPendingJobAgeSeconds: number; expiredActiveReservations: number };

export async function jobHealth(db: Queryable, now: Date): Promise<JobHealth> {
  const result = await db.query<JobHealth>(
    `SELECT
       (SELECT count(*)::int FROM outbox_events WHERE status IN ('PENDING', 'PROCESSING')) AS "pendingJobs",
       (SELECT count(*)::int FROM outbox_events WHERE status = 'FAILED') AS "failedJobs",
       COALESCE((SELECT GREATEST(0, floor(extract(epoch FROM ($1::timestamptz - min(available_at)))))::int
                 FROM outbox_events WHERE status = 'PENDING' AND available_at <= $1), 0) AS "oldestPendingJobAgeSeconds",
       (SELECT count(*)::int FROM reservations WHERE status = 'ACTIVE' AND expires_at <= $1) AS "expiredActiveReservations"`,
    [now],
  );
  return result.rows[0] ?? { pendingJobs: 0, failedJobs: 0, oldestPendingJobAgeSeconds: 0, expiredActiveReservations: 0 };
}

export async function listJobs(db: Queryable, status: JobStatus, page: PageRequest): Promise<Page<JobRow>> {
  assertCursorId(page, 'bigint');
  const result = await db.query<JobRow>(
    `SELECT ${jobColumns()} FROM outbox_events
     WHERE status = $1 AND ($2::bigint IS NULL OR id < $2::bigint)
     ORDER BY id DESC LIMIT $3`,
    [status, page.after?.id ?? null, page.limit + 1],
  );
  return toPage(result.rows, page.limit, (row) => ({ sortKey: row.id, id: row.id }));
}
