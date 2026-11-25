import { OperatorOrdersDocument } from '@ofl/graphql-types';
import { useCallback } from 'react';
import { Link } from 'react-router';
import { CursorPages, Section } from '../../components';
import { useUrlCursors } from '../../app/useUrlCursors';
import { ReceiveReturnButton } from '../orders/ReceiveReturnButton';
import { CURSOR_PARAMS } from './warehouseParams';

export function ReturnsAwaitingReceipt() {
  const { cursors, loadMore } = useUrlCursors(CURSOR_PARAMS.returns);
  const variablesFor = useCallback(
    (after: string | null) => ({ first: 20, after, filter: { withReturnsAwaitingReceipt: true } }),
    [],
  );
  return (
    <Section title="Returns to receive">
      <CursorPages
        query={OperatorOrdersDocument}
        variablesFor={variablesFor}
        select={(data) => data.orders}
        cursors={cursors}
        onLoadMore={loadMore}
        empty={<p>No returns are waiting.</p>}
        renderEdges={(edges) => (
          <ul className="plain-list">
            {edges.map(({ cursor, node: order }) => (
              <li key={cursor} className="inline-form">
                <Link to={`/orders/${order.id}`}>{order.number}</Link>
                <span>{order.customer.displayName}</span>
                {order.allowedActions.receivableReturnIds.map((returnId) => (
                  <ReceiveReturnButton key={returnId} returnId={returnId} />
                ))}
              </li>
            ))}
          </ul>
        )}
      />
    </Section>
  );
}
