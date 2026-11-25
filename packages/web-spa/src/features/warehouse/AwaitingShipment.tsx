import { OperatorOrdersDocument } from '@ofl/graphql-types';
import { useCallback } from 'react';
import { Link } from 'react-router';
import { CursorPages, Section, StatusBadge } from '../../components';
import { useUrlCursors } from '../../app/useUrlCursors';
import { ShipButtons } from '../orders/ShipButtons';
import { CURSOR_PARAMS } from './warehouseParams';

export function AwaitingShipment({ warehouseId }: { warehouseId: string }) {
  const { cursors, loadMore } = useUrlCursors(CURSOR_PARAMS.shipments);
  const variablesFor = useCallback(
    (after: string | null) => ({ first: 20, after, filter: { awaitingShipmentFromWarehouseId: warehouseId } }),
    [warehouseId],
  );
  return (
    <Section title="Awaiting shipment">
      <CursorPages
        query={OperatorOrdersDocument}
        variablesFor={variablesFor}
        select={(data) => data.orders}
        cursors={cursors}
        onLoadMore={loadMore}
        empty={<p>No orders are waiting for this warehouse.</p>}
        renderEdges={(edges) => (
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col">Customer</th>
                <th scope="col">Items to ship</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {edges.map(({ cursor, node: order }) => (
                <tr key={cursor}>
                  <th scope="row">
                    <Link to={`/orders/${order.id}`}>{order.number}</Link>
                  </th>
                  <td>{order.customer.displayName}</td>
                  <td>
                    {order.reservations
                      .filter((r) => r.warehouse.id === warehouseId && r.status === 'CONFIRMED')
                      .map((r) => `${r.sku.code} × ${r.quantity}`)
                      .join(', ')}
                  </td>
                  <td>
                    <StatusBadge status={order.status} />
                  </td>
                  <td>
                    <ShipButtons orderId={order.id} warehouses={order.allowedActions.shippableWarehouses} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      />
    </Section>
  );
}
