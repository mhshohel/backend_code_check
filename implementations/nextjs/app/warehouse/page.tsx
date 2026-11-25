import type { Metadata } from 'next';
import Link from 'next/link';
import { loadOrdersAwaitingShipment, loadWarehouses } from '@/modules/server/data/warehouse';
import { STAFF_ROLES, requireRole } from '@/modules/server/session';
import { ShipOrderControls } from '@/modules/warehouse/ShipOrderControls';
import { OrderStatusBadge } from '@/modules/ui/StatusBadge';
import { Pagination } from '@/modules/ui/Pagination';
import { firstParam, type PageSearchParams } from '@/modules/ui/search-param';
import { formatDateTime } from '@/modules/ui/format';

export const metadata: Metadata = { title: 'Shipping queue' };

type Props = { searchParams: Promise<PageSearchParams> };

export default async function ShippingQueuePage({ searchParams }: Props) {
  await requireRole(STAFF_ROLES, '/warehouse');
  const params = await searchParams;
  const warehouses = await loadWarehouses();
  const selected = warehouses.find((warehouse) => warehouse.id === firstParam(params, 'warehouse')) ?? warehouses[0];
  if (!selected) return <p>No warehouses are configured.</p>;
  const after = firstParam(params, 'after');
  const orders = await loadOrdersAwaitingShipment(selected.id, after);

  return (
    <section>
      <h1>Shipping queue</h1>
      <form method="get" className="inline-form">
        <label htmlFor="warehouse-select">Warehouse</label>
        <select id="warehouse-select" name="warehouse" defaultValue={selected.id}>
          {warehouses.map((warehouse) => (
            <option key={warehouse.id} value={warehouse.id}>
              {warehouse.code} · {warehouse.name}
            </option>
          ))}
        </select>
        <button type="submit">Show</button>
      </form>

      {orders.edges.length === 0 ? (
        <p>No confirmed orders are waiting for {selected.code}.</p>
      ) : (
        <ul className="card-list">
          {orders.edges.map(({ node }) => (
            <li key={node.id} className="card">
              <h2>
                <Link href={`/orders/${node.id}`}>{node.number}</Link> <OrderStatusBadge status={node.status} />
              </h2>
              <p className="muted">
                {node.customer.displayName} · {formatDateTime(node.createdAt)} · {node.total.formatted}
              </p>
              <ul>
                {node.reservations
                  .filter((reservation) => reservation.warehouse.id === selected.id && reservation.status === 'CONFIRMED')
                  .map((reservation) => (
                    <li key={reservation.id}>
                      {reservation.quantity} × {reservation.sku.code}
                    </li>
                  ))}
              </ul>
              <ShipOrderControls
                orderId={node.id}
                orderNumber={node.number}
                warehouses={node.allowedActions.shippableWarehouses.filter((warehouse) => warehouse.id === selected.id)}
              />
            </li>
          ))}
        </ul>
      )}
      <Pagination
        basePath="/warehouse"
        params={new URLSearchParams({ warehouse: selected.id })}
        hasNextPage={orders.pageInfo.hasNextPage}
        endCursor={orders.pageInfo.endCursor}
        isFirstPage={after === null}
      />
    </section>
  );
}
