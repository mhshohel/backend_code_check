import type { Metadata } from 'next';
import Link from 'next/link';
import { LOW_STOCK_THRESHOLD, REVENUE_DAYS, loadOperationsSummary } from '@/modules/server/data/admin';
import { ADMIN_ROLES, requireRole } from '@/modules/server/session';
import { ORDER_STATUS_LABELS } from '@/modules/ui/format';

export const metadata: Metadata = { title: 'Operations' };

export default async function OperationsPage() {
  await requireRole(ADMIN_ROLES, '/admin');
  const summary = await loadOperationsSummary();

  return (
    <section>
      <h1>Operations</h1>
      <dl className="stat-grid">
        <div>
          <dt>Pending jobs</dt>
          <dd>{summary.pendingJobs}</dd>
        </div>
        <div>
          <dt>Failed jobs</dt>
          <dd>
            {summary.failedJobs > 0 ? <Link href="/admin/jobs?status=FAILED">{summary.failedJobs}</Link> : 0}
          </dd>
        </div>
        <div>
          <dt>Oldest pending job</dt>
          <dd>{summary.oldestPendingJobAgeSeconds} s</dd>
        </div>
        <div>
          <dt>Expired active reservations</dt>
          <dd>{summary.expiredActiveReservations}</dd>
        </div>
      </dl>

      <h2>Orders by status</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Status</th>
              <th scope="col">Orders</th>
            </tr>
          </thead>
          <tbody>
            {summary.ordersByStatus.map((row) => (
              <tr key={row.status}>
                <th scope="row">{ORDER_STATUS_LABELS[row.status]}</th>
                <td>{row.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Daily revenue (last {REVENUE_DAYS} days, UTC)</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Orders</th>
              <th scope="col">Revenue</th>
              <th scope="col">Cumulative</th>
            </tr>
          </thead>
          <tbody>
            {summary.dailyRevenue.map((row) => (
              <tr key={row.day}>
                <th scope="row">{row.day}</th>
                <td>{row.orders}</td>
                <td>{row.revenue.formatted}</td>
                <td>{row.cumulativeRevenue.formatted}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Low stock (available at most {LOW_STOCK_THRESHOLD})</h2>
      {summary.lowStock.length === 0 ? (
        <p>No low-stock items.</p>
      ) : (
        <ul>
          {summary.lowStock.map((item) => (
            <li key={`${item.sku.id}:${item.warehouse.id}`}>
              {item.sku.code} ({item.sku.label}) in {item.warehouse.code}: {item.available} available ·{' '}
              <Link href={`/warehouse/movements?sku=${item.sku.id}&warehouse=${item.warehouse.id}`}>history</Link>
            </li>
          ))}
        </ul>
      )}
      <p className="muted">Prices are changed on each product page (administrators see an editor there).</p>
    </section>
  );
}
