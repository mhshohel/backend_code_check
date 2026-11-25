import { MyOrdersDocument, type OrderSummaryFieldsFragment } from '@ofl/graphql-types';
import { useCallback } from 'react';
import { Link } from 'react-router';
import { CursorPages, DateTime, PageHeader, StatusBadge } from '../../components';
import { useUrlCursors } from '../../app/useUrlCursors';

const PAGE_SIZE = 20;

export function MyOrdersPage() {
  const { cursors, loadMore } = useUrlCursors();
  const variablesFor = useCallback((after: string | null) => ({ first: PAGE_SIZE, after }), []);
  return (
    <div>
      <PageHeader title="My orders" />
      <CursorPages
        query={MyOrdersDocument}
        variablesFor={variablesFor}
        select={(data) => data.myOrders}
        cursors={cursors}
        onLoadMore={loadMore}
        loadMoreLabel="Load more orders"
        empty={<p>You have no orders yet.</p>}
        renderEdges={(edges) => (
          <ul className="order-list">
            {edges.map((edge) => (
              <OrderSummaryItem key={edge.cursor} order={edge.node} />
            ))}
          </ul>
        )}
      />
    </div>
  );
}

export function OrderSummaryItem({ order }: { order: OrderSummaryFieldsFragment }) {
  return (
    <li className="card order-summary">
      <Link to={`/orders/${order.id}`}>{order.number}</Link>
      <StatusBadge status={order.status} />
      <span>{order.total.formatted}</span>
      <DateTime value={order.createdAt} />
    </li>
  );
}
